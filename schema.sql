-- ================================================================
-- FileVault Database Schema
-- Run this in psql or any PostgreSQL client
-- ================================================================

CREATE DATABASE filevault;
\c filevault

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       VARCHAR(255) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    full_name   VARCHAR(100),
    created_at  TIMESTAMP DEFAULT NOW(),
    last_login  TIMESTAMP
);

CREATE TABLE files (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename      VARCHAR(255) NOT NULL,
    s3_key        VARCHAR(500) NOT NULL,
    file_size     BIGINT NOT NULL,
    mime_type     VARCHAR(100),
    status        VARCHAR(50) DEFAULT 'uploading',
    description   TEXT,
    last_modified TIMESTAMP DEFAULT NOW(),
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_status  ON files(status);

INSERT INTO users (email, password, full_name)
VALUES (
    'admin@filevault.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'Admin User'
);