const grid = document.getElementById("eventGrid");
const dialog = document.getElementById("buyDialog");
const form = document.getElementById("buyForm");
const result = document.getElementById("buyResult");
let eventCache = [];

const money = value => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value));
const dateLabel = value => new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

async function loadEvents() {
  try {
    const response = await fetch("/api/events");
    if (!response.ok) throw new Error("API no disponible");
    eventCache = await response.json();
    if (!eventCache.length) {
      grid.innerHTML = '<div class="loading-card">No hay eventos disponibles. Agrega registros en database/schema.sql.</div>';
      return;
    }
    grid.innerHTML = eventCache.map((event, index) => `
      <article class="event-card">
        <div class="event-image" style="background-image:linear-gradient(0deg,#090b16aa,transparent 65%),url('${escapeHtml(event.imagen || "")}')">
          <span class="event-pill">${index === 0 ? "DESTACADO" : "ENTRADAS DISPONIBLES"}</span>
        </div>
        <div class="event-body">
          <h3>${escapeHtml(event.nombre)}</h3>
          <div class="artist">${escapeHtml(event.artista)}</div>
          <div class="event-meta">
            <span>◷ &nbsp;${escapeHtml(dateLabel(event.fecha_evento))}</span>
            <span>⌖ &nbsp;${escapeHtml(event.recinto)}, ${escapeHtml(event.ciudad)}</span>
            <span>◈ &nbsp;${Number(event.boletos_disponibles)} boletos disponibles</span>
          </div>
          <div class="event-footer">
            <div class="price"><small>DESDE</small><strong>${money(event.precio)}</strong></div>
            <button class="buy-button" data-buy="${Number(event.id_evento)}">Elegir boletos ↗</button>
          </div>
        </div>
      </article>`).join("");
  } catch {
    grid.innerHTML = '<div class="loading-card">No se pudo conectar con la API. Inicia Node.js e importa la base de datos para cargar eventos reales.</div>';
  }
}

grid.addEventListener("click", event => {
  const button = event.target.closest("[data-buy]");
  if (!button) return;
  const item = eventCache.find(e => Number(e.id_evento) === Number(button.dataset.buy));
  if (!item) return;
  document.getElementById("eventId").value = item.id_evento;
  document.getElementById("dialogTitle").textContent = item.nombre;
  document.getElementById("dialogDescription").textContent = `${dateLabel(item.fecha_evento)} · ${item.recinto}, ${item.ciudad} · ${money(item.precio)} por boleto`;
  document.getElementById("quantity").max = Math.min(8, Number(item.boletos_disponibles));
  result.innerHTML = "";
  dialog.showModal();
});
document.getElementById("closeDialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });

form.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Generando...";
  result.textContent = "";
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: document.getElementById("eventId").value,
        buyerName: document.getElementById("buyerName").value,
        buyerEmail: document.getElementById("buyerEmail").value,
        quantity: Number(document.getElementById("quantity").value)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo crear la orden");
    result.innerHTML = `<div class="ticket-result"><strong>✓ Orden #${data.orderId} creada</strong><p>${escapeHtml(data.event)} · ${data.quantity} boleto(s)</p><p>Total de demostración: ${money(data.total)}</p><p>Estado blockchain: <strong>${escapeHtml(data.blockchain.status)}</strong></p>${data.tickets.map((ticket, i) => { const chain = (data.blockchain.transactions || []).find(x => x.ticketId === ticket.ticketId); return `<p><strong>Boleto ${i + 1}</strong><br>Código: <code>${escapeHtml(ticket.ticketId)}</code><br>Huella SHA-256: <code>${escapeHtml(ticket.ticketHash)}</code><br>Registro: <code>${escapeHtml(chain?.status || "pendiente")}</code>${chain?.txHash ? `<br>Transacción Stellar: <code>${escapeHtml(chain.txHash)}</code>` : ""}</p>`; }).join("")}<p>Esta orden es de demostración y no representa un pago confirmado.</p></div>`;
    await loadEvents();
  } catch (err) {
    result.textContent = err.message;
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Generar boleto de prueba <span>→</span>';
  }
});

loadEvents();


document.getElementById("verifyForm").addEventListener("submit", async event => {
  event.preventDefault();
  const code = document.getElementById("verifyCode").value.trim();
  const output = document.getElementById("verifyResult");
  output.textContent = "Consultando boleto...";
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(code)}/verify`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "No se pudo verificar el boleto.");
    output.innerHTML = `<div class="verify-result-card"><strong>${data.valid ? "✓ Boleto emitido" : "⚠ Boleto no válido para acceso"}</strong><p>Evento: ${escapeHtml(data.event)}</p><p>Estado: <code>${escapeHtml(data.status)}</code> · Blockchain: <code>${escapeHtml(data.blockchainStatus)}</code></p>${data.txHash ? `<p>Transacción Stellar: <code>${escapeHtml(data.txHash)}</code></p>` : ""}<small>${escapeHtml(data.note)}</small></div>`;
  } catch (err) {
    output.innerHTML = `<div class="verify-result-card error">${escapeHtml(err.message)}</div>`;
  }
});
