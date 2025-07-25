const path = require('path');
const fs = require('fs');
const test = require('ava');

const I18N = require('@ladjs/i18n');
const Redis = require('ioredis-mock');

const Mandarin = require('../index');

// Mock Google Translate to avoid API calls during testing
class MockTranslate {
  async translate(text, options) {
    // Simple mock translation - just add [ES] prefix for Spanish
    const locale = typeof options === 'string' ? options : options.to;
    if (locale === 'es') {
      return [`[ES] ${text}`];
    }
    if (locale === 'fr') {
      return [`[FR] ${text}`];
    }
    return [text];
  }
}

test.beforeEach(t => {
  // Setup i18n with multiple locales
  const i18n = new I18N({
    autoReload: true,
    locales: ['en', 'es', 'fr'],
    defaultLocale: 'en'
  });

  // Create mandarin instance with mocked translate client
  const mandarin = new Mandarin({
    i18n,
    redis: new Redis(),
    useTextTranslation: true,
    concurrency: 2
  });

  // Replace the real translate client with our mock
  mandarin.client = new MockTranslate();

  t.context = { mandarin, i18n };
});

test('preserves simple table structure', async t => {
  const { mandarin } = t.context;

  const content = `# Simple Table Test

| Name | Age | City |
|------|-----|------|
| John | 25 | New York |
| Jane | 30 | London |

Regular text after table.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check that table structure is preserved
  const tableLines = result.split('\n').filter(line => line.includes('|'));
  t.is(tableLines.length, 4); // Header + separator + 2 data rows

  // Check that pipe characters are preserved
  t.true(result.includes('| Name | Age | City |'));
  t.true(result.includes('|------|-----|------|'));

  // Check that table content is translated
  t.true(result.includes('| [ES] John | 25 | [ES] New York |'));
  t.true(result.includes('| [ES] Jane | 30 | [ES] London |'));

  // Check that regular text is translated
  t.true(result.includes('[ES] Regular text after table.'));

  // Ensure no HTML entities in table structure
  t.false(result.includes('&#124;'));
});

test('preserves table alignment markers', async t => {
  const { mandarin } = t.context;

  const content = `| Left | Center | Right |
|:-----|:------:|------:|
| L1 | C1 | R1 |
| L2 | C2 | R2 |`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check that alignment markers are preserved
  t.true(result.includes('|:-----|:------:|------:|'));

  // Check that content is translated
  t.true(result.includes('| [ES] Left | [ES] Center | [ES] Right |'));
  t.true(result.includes('| [ES] L1 | [ES] C1 | [ES] R1 |'));
  t.true(result.includes('| [ES] L2 | [ES] C2 | [ES] R2 |'));
});

test('handles tables with inline code', async t => {
  const { mandarin } = t.context;

  const content = `| Function | Code | Description |
|----------|------|-------------|
| Hello | \`console.log("hello")\` | Prints greeting |
| Add | \`function add(a, b)\` | Adds numbers |`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check that inline code in tables is preserved
  t.true(result.includes('`console.log("hello")`'));
  t.true(result.includes('`function add(a, b)`'));

  // Check that surrounding text is translated
  t.true(result.includes('| [ES] Function | [ES] Code | [ES] Description |'));
  t.true(result.includes('| [ES] Hello |'));
  t.true(result.includes('| [ES] Prints greeting |'));
  t.true(result.includes('| [ES] Add |'));
  t.true(result.includes('| [ES] Adds numbers |'));
});

test('handles tables with links', async t => {
  const { mandarin } = t.context;

  const content = `| Service | Link | Status |
|---------|------|--------|
| GitHub | [Repository](https://github.com/example) | Active |
| Docs | [Documentation](https://docs.example.com) | Updated |`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check that links in tables are preserved with URLs intact
  t.true(result.includes('[Repository](https://github.com/example)'));
  t.true(result.includes('[Documentation](https://docs.example.com)'));

  // Check that surrounding text is translated
  t.true(result.includes('| [ES] Service | [ES] Link | [ES] Status |'));
  t.true(result.includes('| [ES] GitHub |'));
  t.true(result.includes('| [ES] Active |'));
  t.true(result.includes('| [ES] Docs |'));
  t.true(result.includes('| [ES] Updated |'));
});

test('handles complex tables with mixed content', async t => {
  const { mandarin } = t.context;

  const content = `| Feature | Code | Link | Status |
|---------|------|------|--------|
| Auth | \`login()\` | [Guide](https://auth.example.com) | ✅ Complete |
| API | \`fetch('/api')\` | [Docs](https://api.example.com) | 🚧 Progress |
| DB | \`query()\` | [Schema](https://db.example.com) | ❌ Pending |`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check table structure
  const tableLines = result.split('\n').filter(line => line.includes('|'));
  t.is(tableLines.length, 5); // Header + separator + 3 data rows

  // Check that code is preserved
  t.true(result.includes('`login()`'));
  t.true(result.includes('`fetch(\'/api\')`'));
  t.true(result.includes('`query()`'));

  // Check that links are preserved
  t.true(result.includes('[Guide](https://auth.example.com)'));
  t.true(result.includes('[Docs](https://api.example.com)'));
  t.true(result.includes('[Schema](https://db.example.com)'));

  // Check that emojis and status are preserved
  t.true(result.includes('✅'));
  t.true(result.includes('🚧'));
  t.true(result.includes('❌'));

  // Check that translatable text is translated
  t.true(result.includes('| [ES] Feature | [ES] Code | [ES] Link | [ES] Status |'));
  t.true(result.includes('| [ES] Auth |'));
  t.true(result.includes('| [ES] Complete |'));
  t.true(result.includes('| [ES] Progress |'));
  t.true(result.includes('| [ES] Pending |'));
});

test('handles multiple tables in same document', async t => {
  const { mandarin } = t.context;

  const content = `# Multiple Tables

First table:

| Name | Age |
|------|-----|
| Alice | 25 |
| Bob | 30 |

Some text between tables.

Second table:

| Product | Price |
|---------|-------|
| Widget | $10 |
| Gadget | $20 |

Final text.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check that both tables are preserved
  const tableLines = result.split('\n').filter(line => line.includes('|'));
  t.is(tableLines.length, 8); // 2 tables × (header + separator + 2 rows each)

  // Check first table
  t.true(result.includes('| [ES] Name | [ES] Age |'));
  t.true(result.includes('| [ES] Alice | 25 |'));
  t.true(result.includes('| [ES] Bob | 30 |'));

  // Check second table
  t.true(result.includes('| [ES] Product | [ES] Price |'));
  t.true(result.includes('| [ES] Widget | $10 |'));
  t.true(result.includes('| [ES] Gadget | $20 |'));

  // Check that text between tables is translated
  t.true(result.includes('[ES] Some text between tables.'));
  t.true(result.includes('[ES] Final text.'));
});

test('handles tables with empty cells', async t => {
  const { mandarin } = t.context;

  const content = `| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value 1 | | Value 3 |
| | Value 2 | |
| Full | Row | Here |`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check that table structure is preserved with empty cells
  t.true(result.includes('| [ES] Value 1 |  | [ES] Value 3 |'));
  t.true(result.includes('|  | [ES] Value 2 |  |'));
  t.true(result.includes('| [ES] Full | [ES] Row | [ES] Here |'));

  // Check header translation
  t.true(result.includes('| [ES] Column 1 | [ES] Column 2 | [ES] Column 3 |'));
});

test('handles tables adjacent to other markdown elements', async t => {
  const { mandarin } = t.context;

  const content = `> [!NOTE]
> This is a note before the table.

| Item | Count |
|------|-------|
| Apples | 5 |
| Oranges | 3 |

\`\`\`javascript
console.log("Code after table");
\`\`\`

Regular text after code.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check that GitHub alert is preserved
  t.true(result.includes('> [!NOTE]'));
  t.true(result.includes('> This is a note before the table.'));

  // Check that table is properly translated
  t.true(result.includes('| [ES] Item | [ES] Count |'));
  t.true(result.includes('| [ES] Apples | 5 |'));
  t.true(result.includes('| [ES] Oranges | 3 |'));

  // Check that code block is preserved
  t.true(result.includes('```javascript'));
  t.true(result.includes('console.log("Code after table");'));

  // Check that regular text is translated
  t.true(result.includes('[ES] Regular text after code.'));
});

test('detectTables method works correctly', async t => {
  const { mandarin } = t.context;

  const content = `Some text

| Header 1 | Header 2 |
|----------|----------|
| Row 1 | Data 1 |
| Row 2 | Data 2 |

More text

| Another | Table |
|---------|-------|
| Value | Here |

Final text`;

  const tables = mandarin.detectTables(content);

  t.is(tables.length, 2);

  // First table
  t.is(tables[0].rows.length, 4); // header + separator + 2 data rows
  t.true(tables[0].originalText.includes('| Header 1 | Header 2 |'));

  // Second table
  t.is(tables[1].rows.length, 3); // header + separator + 1 data row
  t.true(tables[1].originalText.includes('| Another | Table |'));
});

test('translateTableCells method preserves structure', async t => {
  const { mandarin } = t.context;

  const tableText = `| Name | Code | Link |
|------|------|------|
| Test | \`console.log()\` | [URL](https://example.com) |
| Demo | \`alert()\` | [Site](https://demo.com) |`;

  const result = await mandarin.translateTableCells(tableText, 'es');

  // Check that structure is preserved
  const lines = result.split('\n');
  t.is(lines.length, 4);

  // Check separator line is unchanged
  t.true(result.includes('|------|------|------|'));

  // Check that code is preserved
  t.true(result.includes('`console.log()`'));
  t.true(result.includes('`alert()`'));

  // Check that links are preserved
  t.true(result.includes('[URL](https://example.com)'));
  t.true(result.includes('[Site](https://demo.com)'));

  // Check that translatable content is translated
  t.true(result.includes('| [ES] Name | [ES] Code | [ES] Link |'));
  t.true(result.includes('| [ES] Test |'));
  t.true(result.includes('| [ES] Demo |'));
});

// Integration test for the full file processing with tables
test('parseMarkdownFileText processes tables correctly', async t => {
  const { mandarin } = t.context;

  // Create a test markdown file with tables
  const testContent = `# Table Test Document

This document contains a table.

| Name | Age | City |
|------|-----|------|
| John | 25 | New York |
| Jane | 30 | London |

Regular text after table.`;

  const testFilePath = path.join(__dirname, 'test-table-file.md');
  fs.writeFileSync(testFilePath, testContent);

  try {
    await mandarin.parseMarkdownFileText(testFilePath);

    // Check that translated files were created
    const esFilePath = path.join(__dirname, 'test-table-file-es.md');
    const frFilePath = path.join(__dirname, 'test-table-file-fr.md');

    t.true(fs.existsSync(esFilePath));
    t.true(fs.existsSync(frFilePath));

    const esContent = fs.readFileSync(esFilePath, 'utf8');
    const frContent = fs.readFileSync(frFilePath, 'utf8');

    // Spanish file checks
    t.true(esContent.includes('| [ES] Name | [ES] Age | [ES] City |'));
    t.true(esContent.includes('| [ES] John | 25 | [ES] New York |'));
    t.true(esContent.includes('| [ES] Jane | 30 | [ES] London |'));
    t.true(esContent.includes('[ES] Regular text after table.'));
    t.false(esContent.includes('&#124;')); // No HTML entities

    // French file checks
    t.true(frContent.includes('| [FR] Name | [FR] Age | [FR] City |'));
    t.true(frContent.includes('| [FR] John | 25 | [FR] New York |'));
    t.true(frContent.includes('| [FR] Jane | 30 | [FR] London |'));
    t.true(frContent.includes('[FR] Regular text after table.'));
    t.false(frContent.includes('&#124;')); // No HTML entities

    // Cleanup
    fs.unlinkSync(esFilePath);
    fs.unlinkSync(frFilePath);
  } finally {
    // Cleanup test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  }
});

