-- DuskDex — migração inicial (MySQL 8.0+, InnoDB, utf8mb4).
-- Garantias físicas no próprio banco:
--   * uma linha por cópia física → uma única localização atual por cópia;
--   * UNIQUE(slot_binder_id, slot_page_id, slot_index) → no máximo uma cópia por bolso;
--   * UNIQUE(owner_id, idempotency_key) → repetição segura de operações.

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  email VARCHAR(190) NOT NULL,
  username VARCHAR(30) NOT NULL,
  display_name VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  bio VARCHAR(280) NOT NULL DEFAULT '',
  privacy JSON NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  status ENUM('active','suspended','pending_deletion') NOT NULL DEFAULT 'active',
  terms_version VARCHAR(20) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_users_public (public_id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE security_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  type VARCHAR(40) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  meta JSON NULL,
  created_at DATETIME(3) NOT NULL,
  KEY ix_sec_user (user_id, created_at),
  CONSTRAINT fk_sec_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rate_limits (
  bucket VARCHAR(190) NOT NULL,
  window_start INT UNSIGNED NOT NULL,
  hits INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshots de cartas. owner_id = 0 → snapshot global verificado pelo servidor na TCGdex.
-- owner_id > 0 → snapshot privado (carta personalizada ou não verificada).
CREATE TABLE card_snapshots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  card_key VARCHAR(120) NOT NULL,
  card_id VARCHAR(80) NOT NULL,
  lang VARCHAR(10) NOT NULL,
  name VARCHAR(160) NOT NULL,
  data JSON NOT NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_snap (owner_id, card_key),
  KEY ix_snap_card (card_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_cards (
  owner_id BIGINT UNSIGNED NOT NULL,
  card_key VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (owner_id, card_key),
  CONSTRAINT fk_uc_user FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE storage_locations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  name VARCHAR(60) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  description VARCHAR(300) NOT NULL DEFAULT '',
  capacity INT UNSIGNED NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  binder_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_loc_public (public_id),
  KEY ix_loc_owner (owner_id, parent_id),
  CONSTRAINT fk_loc_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_loc_parent FOREIGN KEY (parent_id) REFERENCES storage_locations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE binders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  type ENUM('physical','virtual') NOT NULL,
  layout_rows TINYINT UNSIGNED NOT NULL,
  layout_cols TINYINT UNSIGNED NOT NULL,
  pages JSON NOT NULL,
  appearance JSON NOT NULL,
  location_id BIGINT UNSIGNED NULL,
  visibility ENUM('private','unlisted','public') NOT NULL DEFAULT 'private',
  favorite TINYINT(1) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_binder_public (public_id),
  KEY ix_binder_owner (owner_id, updated_at),
  CONSTRAINT fk_binder_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_binder_loc FOREIGN KEY (location_id) REFERENCES storage_locations(id) ON DELETE SET NULL,
  CONSTRAINT ck_binder_layout CHECK (layout_rows BETWEEN 1 AND 6 AND layout_cols BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE storage_locations ADD CONSTRAINT fk_loc_binder FOREIGN KEY (binder_id) REFERENCES binders(id) ON DELETE CASCADE;

CREATE TABLE decks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(600) NOT NULL DEFAULT '',
  format VARCHAR(20) NOT NULL DEFAULT 'standard',
  cards JSON NOT NULL,
  cover_card_key VARCHAR(120) NULL,
  visibility ENUM('private','unlisted','public') NOT NULL DEFAULT 'private',
  status ENUM('virtual','reserved','assembled') NOT NULL DEFAULT 'virtual',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_deck_public (public_id),
  KEY ix_deck_owner (owner_id, updated_at),
  CONSTRAINT fk_deck_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE card_copies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  card_key VARCHAR(120) NOT NULL,
  card_id VARCHAR(80) NOT NULL,
  lang VARCHAR(10) NOT NULL,
  finish VARCHAR(20) NOT NULL DEFAULT 'normal',
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active','removed') NOT NULL DEFAULT 'active',
  location_id BIGINT UNSIGNED NOT NULL,
  slot_binder_id BIGINT UNSIGNED NULL,
  slot_page_id VARCHAR(24) NULL,
  slot_index SMALLINT UNSIGNED NULL,
  reserved_for BIGINT UNSIGNED NULL,
  deck_assembled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_copy_public (public_id),
  UNIQUE KEY uq_copy_slot (slot_binder_id, slot_page_id, slot_index),
  KEY ix_copy_owner_card (owner_id, card_id, status),
  KEY ix_copy_location (location_id),
  CONSTRAINT fk_copy_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_copy_location FOREIGN KEY (location_id) REFERENCES storage_locations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_copy_binder FOREIGN KEY (slot_binder_id) REFERENCES binders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_copy_deck FOREIGN KEY (reserved_for) REFERENCES decks(id) ON DELETE SET NULL,
  CONSTRAINT ck_copy_slot CHECK ((slot_binder_id IS NULL AND slot_page_id IS NULL AND slot_index IS NULL) OR (slot_binder_id IS NOT NULL AND slot_page_id IS NOT NULL AND slot_index IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inventory_batches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(20) NOT NULL,
  label VARCHAR(160) NOT NULL,
  idempotency_key VARCHAR(64) NULL,
  reverts_batch_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_batch_public (public_id),
  UNIQUE KEY uq_batch_idem (owner_id, idempotency_key),
  KEY ix_batch_owner (owner_id, created_at),
  CONSTRAINT fk_batch_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Histórico somente-inserção (a aplicação nunca faz UPDATE/DELETE aqui).
CREATE TABLE inventory_movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  copy_id BIGINT UNSIGNED NOT NULL,
  card_key VARCHAR(120) NOT NULL,
  from_location_id BIGINT UNSIGNED NULL,
  from_slot JSON NULL,
  to_location_id BIGINT UNSIGNED NULL,
  to_slot JSON NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_mv_public (public_id),
  KEY ix_mv_batch (batch_id),
  KEY ix_mv_copy (copy_id),
  CONSTRAINT fk_mv_batch FOREIGN KEY (batch_id) REFERENCES inventory_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_mv_copy FOREIGN KEY (copy_id) REFERENCES card_copies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE wishlist_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  card_key VARCHAR(120) NOT NULL,
  card_id VARCHAR(80) NOT NULL,
  qty SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  priority ENUM('alta','normal','baixa') NOT NULL DEFAULT 'normal',
  note VARCHAR(140) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_wish_public (public_id),
  UNIQUE KEY uq_wish_card (owner_id, card_id),
  CONSTRAINT fk_wish_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_wish_qty CHECK (qty BETWEEN 1 AND 99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE activity (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(20) NOT NULL,
  text VARCHAR(255) NOT NULL,
  icon VARCHAR(20) NOT NULL DEFAULT 'info',
  created_at DATETIME(3) NOT NULL,
  KEY ix_act_owner (owner_id, created_at),
  CONSTRAINT fk_act_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
