-- DuskDex — migração 002: conclusão do modo servidor.
-- Imagens próprias, recuperação de senha / verificação de e-mail, reversão de movimentos,
-- decks físicos, comunidade (posts, curtidas, comentários, seguidores, bloqueios, denúncias,
-- notificações) e trocas entre colecionadores. Compatível com MySQL 8 e MariaDB 10.4+.

CREATE TABLE assets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  mime VARCHAR(20) NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  path VARCHAR(200) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_asset_public (public_id),
  KEY ix_asset_owner (owner_id, created_at),
  CONSTRAINT fk_asset_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME(3) NULL AFTER email,
  ADD COLUMN password_changed_at DATETIME(3) NULL AFTER password_hash,
  ADD COLUMN avatar_asset_id BIGINT UNSIGNED NULL AFTER bio,
  ADD COLUMN banner_asset_id BIGINT UNSIGNED NULL AFTER avatar_asset_id,
  ADD CONSTRAINT fk_user_avatar FOREIGN KEY (avatar_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_user_banner FOREIGN KEY (banner_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

-- Tokens de uso único (só o hash SHA-256 é guardado).
CREATE TABLE auth_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  purpose VARCHAR(10) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_token_hash (token_hash),
  KEY ix_token_user (user_id, purpose),
  CONSTRAINT fk_token_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Decks montados fisicamente ganham um local de inventário próprio ("Deck box · nome").
ALTER TABLE decks
  ADD COLUMN location_id BIGINT UNSIGNED NULL AFTER status,
  ADD CONSTRAINT fk_deck_loc FOREIGN KEY (location_id) REFERENCES storage_locations(id) ON DELETE SET NULL;
ALTER TABLE storage_locations
  ADD COLUMN deck_id BIGINT UNSIGNED NULL AFTER binder_id,
  ADD CONSTRAINT fk_loc_deck FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE;

-- Cópias marcadas como disponíveis para troca; origem quando chegaram por troca.
ALTER TABLE card_copies
  ADD COLUMN for_trade TINYINT(1) NOT NULL DEFAULT 0 AFTER deck_assembled,
  ADD COLUMN origin_trade_id BIGINT UNSIGNED NULL AFTER for_trade,
  ADD KEY ix_copy_trade (owner_id, for_trade, status);

-- Reversões: cada movimento só pode ser revertido uma vez (chave primária garante, mesmo em corrida).
CREATE TABLE movement_reversions (
  movement_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  revert_batch_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY ix_rev_batch (revert_batch_id),
  CONSTRAINT fk_rev_mv FOREIGN KEY (movement_id) REFERENCES inventory_movements(id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_batch FOREIGN KEY (revert_batch_id) REFERENCES inventory_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE inventory_movements ADD COLUMN reverts_movement_id BIGINT UNSIGNED NULL AFTER to_slot;
ALTER TABLE inventory_batches ADD CONSTRAINT fk_batch_reverts FOREIGN KEY (reverts_batch_id) REFERENCES inventory_batches(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- comunidade
CREATE TABLE follows (
  follower_id BIGINT UNSIGNED NOT NULL,
  followee_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  KEY ix_follow_followee (followee_id),
  CONSTRAINT fk_follow_a FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_follow_b FOREIGN KEY (followee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_follow_self CHECK (follower_id <> followee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_blocks (
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  KEY ix_block_blocked (blocked_id),
  CONSTRAINT fk_block_a FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_block_b FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE posts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  body VARCHAR(1000) NOT NULL,
  attachment_type VARCHAR(10) NOT NULL DEFAULT 'none',
  attachment JSON NULL,
  like_count INT UNSIGNED NOT NULL DEFAULT 0,
  comment_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  hidden_at DATETIME(3) NULL,
  UNIQUE KEY uq_post_public (public_id),
  KEY ix_post_author (author_id, id),
  KEY ix_post_feed (deleted_at, hidden_at, id),
  CONSTRAINT fk_post_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE post_likes (
  post_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (post_id, user_id),
  KEY ix_like_user (user_id),
  CONSTRAINT fk_like_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_like_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE post_comments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  post_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
  body VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  hidden_at DATETIME(3) NULL,
  UNIQUE KEY uq_comment_public (public_id),
  KEY ix_comment_post (post_id, id),
  CONSTRAINT fk_comment_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_comment_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  reporter_id BIGINT UNSIGNED NOT NULL,
  target_type VARCHAR(10) NOT NULL,
  target_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(30) NOT NULL,
  details VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(10) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  resolved_by BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_report_public (public_id),
  UNIQUE KEY uq_report_once (reporter_id, target_type, target_id),
  KEY ix_report_status (status, id),
  CONSTRAINT fk_report_user FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  type VARCHAR(20) NOT NULL,
  ref_type VARCHAR(10) NULL,
  ref_public CHAR(26) NULL,
  text VARCHAR(255) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY ix_notif_user (user_id, id),
  KEY ix_notif_unread (user_id, read_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- trocas
CREATE TABLE trades (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  proposer_id BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  message VARCHAR(500) NOT NULL DEFAULT '',
  response VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  responded_at DATETIME(3) NULL,
  UNIQUE KEY uq_trade_public (public_id),
  KEY ix_trade_proposer (proposer_id, status, id),
  KEY ix_trade_recipient (recipient_id, status, id),
  CONSTRAINT fk_trade_a FOREIGN KEY (proposer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_b FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_trade_self CHECK (proposer_id <> recipient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trade_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trade_id BIGINT UNSIGNED NOT NULL,
  copy_id BIGINT UNSIGNED NOT NULL,
  from_user_id BIGINT UNSIGNED NOT NULL,
  card_key VARCHAR(120) NOT NULL,
  card_id VARCHAR(80) NOT NULL,
  lang VARCHAR(10) NOT NULL,
  finish VARCHAR(20) NOT NULL,
  new_copy_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_trade_copy (trade_id, copy_id),
  KEY ix_titem_copy (copy_id),
  CONSTRAINT fk_titem_trade FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
  CONSTRAINT fk_titem_copy FOREIGN KEY (copy_id) REFERENCES card_copies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
