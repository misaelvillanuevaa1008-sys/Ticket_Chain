CREATE DATABASE IF NOT EXISTS ticketchain
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ticketchain;

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(180) NOT NULL UNIQUE,
  rol ENUM('cliente','admin','acceso') NOT NULL DEFAULT 'cliente',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eventos (
  id_evento INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  artista VARCHAR(160) NOT NULL,
  recinto VARCHAR(180) NOT NULL,
  ciudad VARCHAR(100) NOT NULL,
  fecha_evento DATETIME NOT NULL,
  precio DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
  boletos_disponibles INT NOT NULL DEFAULT 0 CHECK (boletos_disponibles >= 0),
  imagen VARCHAR(500),
  descripcion TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ordenes (
  id_orden BIGINT AUTO_INCREMENT PRIMARY KEY,
  id_evento INT NOT NULL,
  comprador_nombre VARCHAR(120) NOT NULL,
  comprador_email VARCHAR(180) NOT NULL,
  cantidad INT NOT NULL CHECK (cantidad BETWEEN 1 AND 8),
  total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
  estado ENUM('pendiente','pagada','cancelada','reembolsada') NOT NULL DEFAULT 'pendiente',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orden_evento FOREIGN KEY (id_evento) REFERENCES eventos(id_evento)
);

CREATE TABLE IF NOT EXISTS boletos (
  id_boleto BIGINT AUTO_INCREMENT PRIMARY KEY,
  id_orden BIGINT NOT NULL,
  id_evento INT NOT NULL,
  codigo_unico CHAR(36) NOT NULL UNIQUE,
  hash_prueba CHAR(64) NOT NULL,
  holder_hash CHAR(64) NOT NULL,
  estado ENUM('emitido','usado','cancelado') NOT NULL DEFAULT 'emitido',
  stellar_tx_hash VARCHAR(128) NULL,
  stellar_contract_id VARCHAR(64) NULL,
  blockchain_estado ENUM('pendiente','registrado','error') NOT NULL DEFAULT 'pendiente',
  fecha_uso DATETIME NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_boleto_orden FOREIGN KEY (id_orden) REFERENCES ordenes(id_orden),
  CONSTRAINT fk_boleto_evento FOREIGN KEY (id_evento) REFERENCES eventos(id_evento)
);

INSERT INTO eventos
(nombre, artista, recinto, ciudad, fecha_evento, precio, boletos_disponibles, imagen, descripcion)
SELECT 'Neón: Live Experience', 'Neón Collective', 'Foro Aurora', 'Ciudad de México',
       DATE_ADD(NOW(), INTERVAL 45 DAY), 850.00, 120,
       'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1200&q=85',
       'Una noche de música electrónica, visuales inmersivos y producción de alto nivel.'
WHERE NOT EXISTS (SELECT 1 FROM eventos WHERE nombre = 'Neón: Live Experience');

INSERT INTO eventos
(nombre, artista, recinto, ciudad, fecha_evento, precio, boletos_disponibles, imagen, descripcion)
SELECT 'Frecuencia Festival', 'Varios artistas', 'Parque Metropolitano', 'Guadalajara',
       DATE_ADD(NOW(), INTERVAL 70 DAY), 1250.00, 240,
       'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=85',
       'Un festival para descubrir nuevos sonidos y vivir la música en comunidad.'
WHERE NOT EXISTS (SELECT 1 FROM eventos WHERE nombre = 'Frecuencia Festival');

INSERT INTO eventos
(nombre, artista, recinto, ciudad, fecha_evento, precio, boletos_disponibles, imagen, descripcion)
SELECT 'Acústico Bajo las Estrellas', 'Luna Norte', 'Teatro del Lago', 'Querétaro',
       DATE_ADD(NOW(), INTERVAL 95 DAY), 620.00, 85,
       'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1200&q=85',
       'Una presentación íntima con arreglos acústicos y una puesta en escena envolvente.'
WHERE NOT EXISTS (SELECT 1 FROM eventos WHERE nombre = 'Acústico Bajo las Estrellas');
