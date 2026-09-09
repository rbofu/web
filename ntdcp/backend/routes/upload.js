const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'frontend', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Images (for news/activity/partner pictures) and common document types (for resources/publications).
const ALLOWED_EXT = /jpeg|jpg|png|gif|webp|svg|pdf|doc|docx|xls|xlsx|ppt|pptx/;
const ALLOWED_MIME = /^image\/|^application\/pdf$|^application\/msword$|^application\/vnd\.openxmlformats|^application\/vnd\.ms-/;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
    cb(null, `${Date.now()}-${base || 'file'}${ext}`);
  }
});

function fileFilter(req, file, cb){
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (ALLOWED_EXT.test(ext) && ALLOWED_MIME.test(file.mimetype)){
    return cb(null, true);
  }
  cb(new Error('Unsupported file type. Allowed: images, PDF, Word, Excel, PowerPoint.'));
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// POST /api/admin/upload  (multipart field name: "file")
router.post('/upload', requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err){
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file){
      return res.status(400).json({ error: 'No file received' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.status(201).json({ url, name: req.file.originalname });
  });
});

module.exports = router;
