// SaveBook D1 Database Module
// Handles persistence of conversion records and site statistics

// ============================================================
// Save a conversion record
// ============================================================
export async function saveConversion(db, data) {
    const { sessionId, url, title, filename, format, fileSize, r2Path } = data;

    const result = await db
        .prepare(
            `INSERT INTO conversions (session_id, url, title, filename, format, file_size, r2_path)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             RETURNING id`
        )
        .bind(sessionId, url, title, filename, format, fileSize, r2Path)
        .first();

    return result?.id || null;
}

// ============================================================
// Get conversion records for a session
// ============================================================
export async function getConversions(db, sessionId, page = 1, limit = 10) {
    const offset = (page - 1) * limit;

    const result = await db
        .prepare(
            `SELECT id, url, title, filename, format, file_size, r2_path, created_at
             FROM conversions
             WHERE session_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
        )
        .bind(sessionId, limit, offset)
        .all();

    return result.results || [];
}

// ============================================================
// Delete a conversion record (and its R2 file via caller)
// ============================================================
export async function deleteConversion(db, id) {
    const record = await db
        .prepare('SELECT r2_path FROM conversions WHERE id = ?')
        .bind(id)
        .first();

    await db.prepare('DELETE FROM conversions WHERE id = ?').bind(id).run();

    return record?.r2_path || null;
}

// ============================================================
// Update global site statistics
// ============================================================
export async function updateStats(db, format) {
    const isPdf = format === 'pdf' ? 1 : 0;
    const isEpub = format === 'epub' ? 1 : 0;

    // Ensure the stats row exists, then update atomically
    await db
        .prepare(
            `INSERT INTO site_stats (id, total_conversions, total_pdf, total_epub, updated_at)
             VALUES (1, 0, 0, 0, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO NOTHING`
        )
        .run();

    await db
        .prepare(
            `UPDATE site_stats
             SET total_conversions = total_conversions + 1,
                 total_pdf = total_pdf + ?,
                 total_epub = total_epub + ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = 1`
        )
        .bind(isPdf, isEpub)
        .run();
}

// ============================================================
// Get current statistics
// ============================================================
export async function getStats(db) {
    const row = await db
        .prepare(
            'SELECT total_conversions, total_pdf, total_epub, updated_at FROM site_stats WHERE id = 1'
        )
        .first();

    return row || { total_conversions: 0, total_pdf: 0, total_epub: 0, updated_at: null };
}

// ============================================================
// Cleanup old records (call from a Cron Trigger)
// ============================================================
export async function deleteOldConversions(db, daysOld = 30) {
    const result = await db
        .prepare(
            `DELETE FROM conversions
             WHERE created_at < datetime('now', '-' || ? || ' days')
             RETURNING id, r2_path`
        )
        .bind(daysOld)
        .all();

    return result.results || [];
}
