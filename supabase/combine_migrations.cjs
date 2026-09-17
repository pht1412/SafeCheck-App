const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, 'migrations');
const outputFile = path.join(__dirname, 'schema_full.sql');

const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log('Found migrations:', files);

let fullSql = `-- ==============================================================================
-- SAFECHECK FULL DATABASE SCHEMA (CONSOLIDATED SNAPSHOT)
-- Generated automatically from migrations:
${files.map(f => `--   - ${f}`).join('\n')}
--
-- Dành cho việc Bàn giao (Handoff) hoặc Khởi tạo dự án mới từ con số 0.
-- Không cần phải chạy từng câu lệnh lẻ. Chỉ cần dán toàn bộ file này vào Supabase SQL Editor.
-- ==============================================================================

`;

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  fullSql += `\n-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\n`;
  fullSql += `-- MIGRATION: ${file}\n`;
  fullSql += `-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\n\n`;
  fullSql += content + '\n';
}

fs.writeFileSync(outputFile, fullSql, 'utf8');
console.log(`Successfully generated ${outputFile} (${fullSql.length} bytes)`);
