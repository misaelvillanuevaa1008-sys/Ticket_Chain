require("dotenv").config();
const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const stellar = require("./stellar-service");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ticketchain",
  waitForConnections: true,
  connectionLimit: 10
};
let pool;

async function getPool() {
  if (!pool) pool = mysql.createPool(dbConfig);
  return pool;
}

app.get("/api/health", async (_req, res) => {
  try {
    const p = await getPool();
    await p.query("SELECT 1");
    res.json({ ok: true, database: "connected", blockchain: "pending-contract-configuration" });
  } catch (err) {
    res.status(503).json({ ok: false, database: "disconnected", message: "Revisa MySQL y el archivo .env." });
  }
});

app.get("/api/events", async (_req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query(`
      SELECT id_evento, nombre, artista, recinto, ciudad, fecha_evento,
             precio, boletos_disponibles, imagen, descripcion
      FROM eventos
      WHERE activo = 1 AND fecha_evento >= NOW()
      ORDER BY fecha_evento ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "No fue posible consultar los eventos. Importa database/schema.sql." });
  }
});

app.post("/api/orders", async (req, res) => {
  const { eventId, buyerName, buyerEmail, quantity } = req.body || {};
  const qty = Number(quantity);
  if (!Number.isInteger(Number(eventId)) || !buyerName?.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail || "") ||
      !Number.isInteger(qty) || qty < 1 || qty > 8) {
    return res.status(400).json({ error: "Revisa el evento, nombre, correo y cantidad (1 a 8)." });
  }

  let conn;
  try {
    const p = await getPool();
    conn = await p.getConnection();
    await conn.beginTransaction();

    const [events] = await conn.query(
      "SELECT id_evento, nombre, precio, boletos_disponibles FROM eventos WHERE id_evento = ? AND activo = 1 FOR UPDATE",
      [Number(eventId)]
    );
    if (!events.length) {
      await conn.rollback();
      return res.status(404).json({ error: "El evento no existe o está inactivo." });
    }
    const event = events[0];
    if (event.boletos_disponibles < qty) {
      await conn.rollback();
      return res.status(409).json({ error: "No hay suficientes boletos disponibles." });
    }

    const total = Number(event.precio) * qty;
    const [order] = await conn.query(
      "INSERT INTO ordenes (id_evento, comprador_nombre, comprador_email, cantidad, total, estado) VALUES (?, ?, ?, ?, ?, 'pendiente')",
      [event.id_evento, buyerName.trim(), buyerEmail.trim().toLowerCase(), qty, total]
    );

    const tickets = [];
    for (let i = 0; i < qty; i++) {
      const crypto = require("crypto");
      const ticketId = crypto.randomUUID();
      const proof = crypto.createHash("sha256").update(`${ticketId}|${order.insertId}|${event.id_evento}`).digest("hex");
      const hashes = stellar.makeHashes(ticketId, buyerEmail.trim().toLowerCase(), order.insertId);
      await conn.query(
        "INSERT INTO boletos (id_orden, id_evento, codigo_unico, hash_prueba, holder_hash, estado) VALUES (?, ?, ?, ?, ?, 'emitido')",
        [order.insertId, event.id_evento, ticketId, hashes.ticketHash, hashes.holderHash]
      );
      tickets.push({ ticketId, proof, ticketHash: hashes.ticketHash, holderHash: hashes.holderHash });
    }
    await conn.query(
      "UPDATE eventos SET boletos_disponibles = boletos_disponibles - ? WHERE id_evento = ?",
      [qty, event.id_evento]
    );
    await conn.commit();

    // La orden es de demostración: no se confirma pago. Si se configura un contrato
    // de Testnet, cada boleto se registra on-chain y se persiste su hash de transacción.
    let chainResults = [];
    if (stellar.configured()) {
      for (const ticket of tickets) {
        try {
          const chain = await stellar.issueTicket({ ticketHash: ticket.ticketHash, holderHash: ticket.holderHash, eventId: event.id_evento });
          await (await getPool()).query(
            "UPDATE boletos SET blockchain_estado='registrado', stellar_tx_hash=?, stellar_contract_id=? WHERE codigo_unico=?",
            [chain.txHash, chain.contractId, ticket.ticketId]
          );
          chainResults.push({ ticketId: ticket.ticketId, ...chain });
        } catch (chainError) {
          console.error("Stellar issue failed:", chainError.message);
          await (await getPool()).query("UPDATE boletos SET blockchain_estado='error' WHERE codigo_unico=?", [ticket.ticketId]);
          chainResults.push({ ticketId: ticket.ticketId, registered: false, status: "error", message: "No se pudo registrar en Stellar; revisar configuración y logs." });
        }
      }
    } else {
      chainResults = tickets.map(t => ({ ticketId: t.ticketId, registered: false, status: "not_configured", message: "Configura STELLAR_ADMIN_SECRET y STELLAR_CONTRACT_ID." }));
    }
    res.status(201).json({
      message: "Orden de demostración creada. No se ha procesado ningún pago real.",
      orderId: order.insertId, event: event.nombre, quantity: qty, total,
      blockchain: { status: chainResults.every(r => r.registered) ? "registered" : "partial_or_not_configured", transactions: chainResults },
      tickets: tickets.map(({holderHash, ...ticket}) => ticket)
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err.message);
    res.status(500).json({ error: "No se pudo crear la orden." });
  } finally {
    if (conn) conn.release();
  }
});


app.get("/api/tickets/:code/verify", async (req, res) => {
  try {
    const p = await getPool();
    const [rows] = await p.query(`
      SELECT b.codigo_unico, b.hash_prueba, b.estado, b.blockchain_estado,
             b.stellar_tx_hash, b.stellar_contract_id, e.nombre AS evento, e.fecha_evento
      FROM boletos b JOIN eventos e ON e.id_evento=b.id_evento
      WHERE b.codigo_unico=? LIMIT 1
    `, [req.params.code]);
    if (!rows.length) return res.status(404).json({ valid: false, message: "Boleto no encontrado." });
    const t = rows[0];
    res.json({ valid: t.estado === "emitido", ticketId: t.codigo_unico, status: t.estado,
      blockchainStatus: t.blockchain_estado, txHash: t.stellar_tx_hash,
      contractId: t.stellar_contract_id, event: t.evento, eventDate: t.fecha_evento,
      note: "Estado consultado en la base de datos; para verificación on-chain independiente se debe consultar el contrato desplegado." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "No se pudo verificar el boleto." });
  }
});

app.post("/api/tickets/:code/check-in", async (req, res) => {
  const code = req.params.code;
  try {
    const p = await getPool();
    const [result] = await p.query(
      "UPDATE boletos SET estado = 'usado', fecha_uso = NOW() WHERE codigo_unico = ? AND estado = 'emitido'",
      [code]
    );
    if (!result.affectedRows) {
      const [rows] = await p.query("SELECT estado FROM boletos WHERE codigo_unico = ?", [code]);
      return res.status(409).json({
        valid: false,
        message: rows.length ? `Boleto no disponible: ${rows[0].estado}.` : "Boleto no encontrado."
      });
    }
    res.json({ valid: true, message: "Acceso validado. El boleto quedó marcado como usado." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "No se pudo validar el boleto." });
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`TicketChain disponible en http://localhost:${port}`));
