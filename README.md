# TicketChain

Plataforma de demostración para venta y verificación de boletos. Stack: Node.js + Express, MySQL, Rust, Soroban y Stellar CLI.

## Estado de esta entrega

- Catálogo web responsive con diseño oscuro premium.
- API Node.js para listar eventos, crear órdenes y validar check-in.
- MySQL para eventos, órdenes y boletos.
- Generación de identificadores únicos y huellas SHA-256 locales.
- Contrato Soroban en Rust para emitir, consultar, usar y cancelar boletos, con lista de verificadores autorizados.
- Integración backend mediante `@stellar/stellar-sdk`: si se configura un contrato desplegado y una clave de administrador de Testnet, la compra de demostración intenta registrar cada boleto y presenta el estado/tx hash en el frontend.
- El endpoint de verificación informa el estado almacenado; la consulta independiente on-chain y el flujo de pagos reales requieren trabajo adicional. No se procesan pagos reales.

## Requisitos

- Node.js LTS y npm.
- MySQL 8.x (o versión compatible con `CHECK`).
- Rust toolchain y Stellar CLI para el contrato.
- Visual Studio Code recomendado.

## 1. Crear la base de datos

Abre MySQL Workbench o la consola y ejecuta todo `database/schema.sql`. El script crea `ticketchain`, sus tablas y tres eventos de ejemplo.

## 2. Configurar Node.js

En PowerShell, dentro de la carpeta `TicketChain`:

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm run dev
```

Edita `.env` con tu usuario y contraseña de MySQL. Abre `http://localhost:3000`.

Prueba el estado de la API en `http://localhost:3000/api/health`.

## 3. Compilar y probar el contrato

Instala Rust y Stellar CLI siguiendo las instrucciones oficiales:  
https://developers.stellar.org/docs/tools/cli  
https://developers.stellar.org/docs/build/smart-contracts/getting-started/hello-world

Desde la raíz del proyecto, la estructura de este contrato es una crate Rust independiente. Para usar el flujo recomendado de Soroban CLI, crea un workspace mediante `stellar contract init`, mueve `contracts/ticket_registry` a su directorio de workspace generado y ajusta la sección `[workspace.dependencies]` si deseas centralizar la versión del SDK.

Alternativamente, desde `contracts/ticket_registry`:

```powershell
cargo test
stellar contract build
```

Si tu versión de CLI requiere que el contrato esté dentro de un workspace Soroban generado, usa el flujo recomendado de `stellar contract init` en la documentación oficial. No despliegues a Mainnet durante el desarrollo.

Para desplegar un contrato ya compilado en Testnet, crea una identidad de prueba y usa la ruta real del archivo WASM que haya generado la compilación:

```powershell
stellar keys generate ticket-admin --network testnet --fund
stellar keys address ticket-admin
stellar contract deploy --wasm RUTA_REAL_AL_ARCHIVO.wasm --source-account ticket-admin --network testnet --alias ticket_registry
```

Guarda el ID de contrato que devuelve la CLI. El despliegue por sí solo no conecta automáticamente la web: hace falta invocar las funciones `initialize`, `issue`, `get_ticket` y `use_ticket` desde un servicio backend que firme transacciones de forma segura.

## Integración Stellar (Testnet)

1. Compila y despliega el contrato Soroban usando el flujo oficial de Stellar CLI.
2. Inicializa el contrato una sola vez con la cuenta administradora; puede hacerse con Stellar CLI usando los argumentos `admin` requeridos por el ABI. La misma cuenta debe corresponder a `STELLAR_ADMIN_SECRET`.
3. Copia el ID desplegado a `.env` en `STELLAR_CONTRACT_ID` y guarda la clave secreta de la cuenta de prueba en `STELLAR_ADMIN_SECRET`. **Nunca pongas esta clave en el frontend, Git ni una captura de pantalla.**
4. Reinicia `npm run dev`. Al crear una orden demo, Node.js invoca `issue` por el SDK; la respuesta de compra muestra el estado y la transacción si se confirmó.
5. La primera compra solo funcionará tras inicializar el contrato. No uses claves de Mainnet.

La clave de administrador debe tener fondos de Testnet. El backend firma transacciones como administrador; el navegador nunca recibe la clave secreta. La invocación de `initialize` es una operación de configuración única y no se ejecuta automáticamente desde la web.

## API incluida

- `GET /api/health`: estado de API/base de datos.
- `GET /api/events`: eventos futuros activos.
- `POST /api/orders`: cuerpo JSON `{ "eventId": 1, "buyerName": "Ana", "buyerEmail": "ana@example.com", "quantity": 2 }`.
- `GET /api/tickets/:code/verify`: consulta estado y metadatos del boleto almacenados en MySQL; el formulario “¿Tu boleto es auténtico?” del frontend usa esta ruta y muestra la referencia Stellar cuando existe.
- `POST /api/tickets/:code/check-in`: marca un boleto emitido como usado en MySQL (validación demo; no invoca aún `use_ticket` on-chain).

## Limitaciones y tareas necesarias antes de producción

1. Añadir registro/login seguro, sesiones o JWT, hash de contraseñas y roles; no guardar secretos en el frontend.
2. Integrar un proveedor de pagos y marcar órdenes como pagadas solo mediante webhook verificado.
3. Conectar backend a Soroban: calcular el hash canónico del boleto, invocar `issue` y guardar `stellar_tx_hash` y `stellar_contract_id`.
4. Reforzar autorización del check-in. En el contrato de ejemplo cualquier dirección autenticada puede intentar usar un boleto; producción debe restringir verificadores autorizados.
5. Añadir pruebas de integración, límites de solicitudes, validación de entradas, logs, copias de seguridad y política de privacidad.
6. No guardar nombres, correos ni datos personales on-chain. Usar identificadores aleatorios y hashes.
7. Un hash no evita por sí solo la reventa fraudulenta ni demuestra el pago. Las reglas de emisión, transferencias, reembolso y cancelación deben quedar definidas.

## Modelo de datos

`eventos 1—N ordenes 1—N boletos`; cada boleto referencia un evento y contiene código único, hash y estado.
