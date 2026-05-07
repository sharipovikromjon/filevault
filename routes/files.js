const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const requireAuth = require("../middleware/auth");

const router = express.Router();

const s3 = new AWS.S3({
  region: process.env.AWS_REGION || "us-east-1",
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

async function uploadToS3(buffer, s3Key, mimeType) {
  return s3
    .upload({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
    })
    .promise();
}

async function deleteFromS3(s3Key) {
  return s3
    .deleteObject({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
    })
    .promise();
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, filename, file_size, mime_type, status,
							description, last_modified, created_at
			 FROM files
			 WHERE user_id = $1 AND status != 'deleted'
			 ORDER BY last_modified DESC`,
      [req.session.user.id],
    );

    res.json({ files: result.rows });
  } catch (err) {
    console.error("Get files error:", err);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }

  const { originalname, size, mimetype, buffer } = req.file;
  const description = req.body.description || "";
  const fileId = uuidv4();
  const s3Key = `uploads/${req.session.user.id}/${fileId}/${originalname}`;

  try {
    await db.query(
      `INSERT INTO files
				(id, user_id, filename, s3_key, file_size, mime_type, status, description)
			 VALUES ($1, $2, $3, $4, $5, $6, 'uploading', $7)`,
      [
        fileId,
        req.session.user.id,
        originalname,
        s3Key,
        size,
        mimetype,
        description,
      ],
    );
  } catch (err) {
    console.error("DB insert error:", err);
    return res.status(500).json({ error: "Failed to create file record" });
  }

  try {
    await uploadToS3(buffer, s3Key, mimetype);
  } catch (err) {
    console.error("S3 upload error:", err);
    await db.query("UPDATE files SET status = 'error' WHERE id = $1", [fileId]);
    return res.status(500).json({ error: "File upload to S3 failed" });
  }

  const updated = await db.query(
    `UPDATE files
		 SET status = 'synced', last_modified = NOW()
		 WHERE id = $1
		 RETURNING *`,
    [fileId],
  );

  res.status(201).json({ success: true, file: updated.rows[0] });
});

router.put("/:id", requireAuth, upload.single("file"), async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await db.query(
      "SELECT * FROM files WHERE id = $1 AND user_id = $2",
      [id, req.session.user.id],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    const file = existing.rows[0];
    const description = req.body.description ?? file.description;

    if (!req.file) {
      const result = await db.query(
        `UPDATE files
				 SET description = $1, last_modified = NOW()
				 WHERE id = $2
				 RETURNING *`,
        [description, id],
      );

      return res.json({ success: true, file: result.rows[0] });
    }

    const { originalname, size, mimetype, buffer } = req.file;
    const newS3Key = `uploads/${req.session.user.id}/${id}/${originalname}`;

    try {
      await uploadToS3(buffer, newS3Key, mimetype);
    } catch (err) {
      console.error("S3 replace error:", err);
      return res.status(500).json({ error: "Failed to replace file in S3" });
    }

    try {
      await deleteFromS3(file.s3_key);
    } catch (err) {
      console.warn("Warning: Could not delete old S3 object:", err.message);
    }

    const result = await db.query(
      `UPDATE files
			 SET filename = $1, s3_key = $2, file_size = $3,
					 mime_type = $4, description = $5,
					 status = 'synced', last_modified = NOW()
			 WHERE id = $6
			 RETURNING *`,
      [originalname, newS3Key, size, mimetype, description, id],
    );

    res.json({ success: true, file: result.rows[0] });
  } catch (err) {
    console.error("Update file error:", err);
    res.status(500).json({ error: "Failed to update file" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await db.query(
      "SELECT * FROM files WHERE id = $1 AND user_id = $2",
      [id, req.session.user.id],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }

    const file = existing.rows[0];

    await db.query("UPDATE files SET status = 'deleted' WHERE id = $1", [id]);

    try {
      await deleteFromS3(file.s3_key);
    } catch (err) {
      console.error("S3 delete error (orphaned object):", err.message);
    }

    res.json({ success: true, message: "File deleted" });
  } catch (err) {
    console.error("Delete file error:", err);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

module.exports = router;
