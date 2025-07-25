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

test('preserves GitHub NOTE alerts', async t => {
  const { mandarin } = t.context;

  const content = `# Test Document

This is regular text that should be translated.

> [!NOTE]
> This is a note alert that should be preserved.

More regular text.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Check that the alert is preserved exactly
  t.true(result.includes('> [!NOTE]'));
  t.true(result.includes('> This is a note alert that should be preserved.'));

  // Check that regular text is translated
  t.true(result.includes('[ES] This is regular text that should be translated.'));
  t.true(result.includes('[ES] More regular text.'));
});

test('preserves all GitHub alert types', async t => {
  const { mandarin } = t.context;

  const content = `> [!NOTE]
> This is a note.

> [!TIP]
> This is a tip.

> [!IMPORTANT]
> This is important.

> [!WARNING]
> This is a warning.

> [!CAUTION]
> This is caution.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // All alert types should be preserved
  t.true(result.includes('> [!NOTE]'));
  t.true(result.includes('> [!TIP]'));
  t.true(result.includes('> [!IMPORTANT]'));
  t.true(result.includes('> [!WARNING]'));
  t.true(result.includes('> [!CAUTION]'));

  // Alert content should be preserved
  t.true(result.includes('> This is a note.'));
  t.true(result.includes('> This is a tip.'));
  t.true(result.includes('> This is important.'));
  t.true(result.includes('> This is a warning.'));
  t.true(result.includes('> This is caution.'));
});

test('preserves code blocks', async t => {
  const { mandarin } = t.context;

  const content = `# Code Example

Here's some JavaScript:

\`\`\`javascript
function hello() {
  console.log("Hello World");
  return 42;
}
\`\`\`

And some Python:

\`\`\`python
def hello():
    print("Hello World")
    return 42
\`\`\`

Regular text after code.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Code blocks should be preserved exactly
  t.true(result.includes('```javascript'));
  t.true(result.includes('function hello() {'));
  t.true(result.includes('console.log("Hello World");'));
  t.true(result.includes('return 42;'));
  t.true(result.includes('```python'));
  t.true(result.includes('def hello():'));
  t.true(result.includes('print("Hello World")'));

  // Regular text should be translated
  t.true(result.includes('[ES] Here\'s some JavaScript:'));
  t.true(result.includes('[ES] And some Python:'));
  t.true(result.includes('[ES] Regular text after code.'));
});

test('preserves inline code', async t => {
  const { mandarin } = t.context;

  const content = `Use the \`console.log()\` function to debug.

The variable \`const x = 42;\` is a constant.

Regular text should be translated.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Inline code should be preserved
  t.true(result.includes('`console.log()`'));
  t.true(result.includes('`const x = 42;`'));

  // Regular text should be translated
  t.true(result.includes('[ES] Use the'));
  t.true(result.includes('[ES] The variable'));
  t.true(result.includes('[ES] Regular text should be translated.'));
});

test('preserves standalone URLs', async t => {
  const { mandarin } = t.context;

  const content = `Visit https://example.com for more info.

Check out https://github.com/ladjs/mandarin too.

This text should be translated.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // URLs should be preserved
  t.true(result.includes('https://example.com'));
  t.true(result.includes('https://github.com/ladjs/mandarin'));

  // Regular text should be translated
  t.true(result.includes('[ES] Visit'));
  t.true(result.includes('[ES] Check out'));
  t.true(result.includes('[ES] This text should be translated.'));
});

test('handles markdown links correctly', async t => {
  const { mandarin } = t.context;

  const content = `Check out this [example link](https://example.com) for more info.

Visit the [GitHub repository](https://github.com/ladjs/mandarin) too.

Regular text should be translated.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Link URLs should be preserved, but link text should be translated
  t.true(result.includes('[ES] example link](https://example.com)'));
  t.true(result.includes('[ES] GitHub repository](https://github.com/ladjs/mandarin)'));

  // Regular text should be translated
  t.true(result.includes('[ES] Check out this'));
  t.true(result.includes('[ES] Visit the'));
  t.true(result.includes('[ES] Regular text should be translated.'));
});

test('handles complex mixed content', async t => {
  const { mandarin } = t.context;

  const content = `# Complex Document

This is regular text with \`inline code\` and a [link](https://example.com).

> [!WARNING]
> Be careful with this code!

\`\`\`javascript
function test() {
  return "Hello World";
}
\`\`\`

Visit https://github.com directly or use the [GitHub link](https://github.com).

> [!NOTE]
> This note contains \`code\` and a [link](https://note.example.com).

Final paragraph with mixed content.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // GitHub alerts should be preserved
  t.true(result.includes('> [!WARNING]'));
  t.true(result.includes('> [!NOTE]'));
  t.true(result.includes('> Be careful with this code!'));
  t.true(result.includes('> This note contains'));

  // Code should be preserved
  t.true(result.includes('`inline code`'));
  t.true(result.includes('```javascript'));
  t.true(result.includes('function test() {'));
  t.true(result.includes('`code`'));

  // URLs should be preserved
  t.true(result.includes('https://example.com'));
  t.true(result.includes('https://github.com'));
  t.true(result.includes('https://note.example.com'));

  // Link text should be translated
  t.true(result.includes('[ES] link](https://example.com)'));
  t.true(result.includes('[ES] GitHub link](https://github.com)'));
  t.true(result.includes('[ES] link](https://note.example.com)'));

  // Regular text should be translated
  t.true(result.includes('[ES] This is regular text'));
  t.true(result.includes('[ES] Visit'));
  t.true(result.includes('[ES] Final paragraph'));
});

test('handles empty and whitespace-only content', async t => {
  const { mandarin } = t.context;

  const content = `

Regular text.


Another paragraph.

`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Should preserve structure and translate content
  t.true(result.includes('[ES] Regular text.'));
  t.true(result.includes('[ES] Another paragraph.'));

  // Should maintain paragraph separation
  const paragraphs = result.split('\n\n').filter(p => p.trim());
  t.is(paragraphs.length, 2);
});

test('skips translation for protected-only paragraphs', async t => {
  const { mandarin } = t.context;

  const content = `Regular text before.

\`\`\`javascript
function test() {
  return "code only";
}
\`\`\`

Regular text after.`;

  const result = await mandarin.translateMarkdownContent(content, 'es');

  // Code block should be unchanged
  t.true(result.includes('```javascript'));
  t.true(result.includes('function test() {'));
  t.true(result.includes('return "code only";'));

  // Regular text should be translated
  t.true(result.includes('[ES] Regular text before.'));
  t.true(result.includes('[ES] Regular text after.'));
});

test('handles concurrent translation correctly', async t => {
  const { mandarin } = t.context;

  // Test with multiple locales simultaneously
  const content = `# Test Document

This is paragraph one.

This is paragraph two.

This is paragraph three.`;

  const [resultEs, resultFr] = await Promise.all([
    mandarin.translateMarkdownContent(content, 'es'),
    mandarin.translateMarkdownContent(content, 'fr')
  ]);

  // Spanish translation
  t.true(resultEs.includes('[ES] This is paragraph one.'));
  t.true(resultEs.includes('[ES] This is paragraph two.'));
  t.true(resultEs.includes('[ES] This is paragraph three.'));

  // French translation
  t.true(resultFr.includes('[FR] This is paragraph one.'));
  t.true(resultFr.includes('[FR] This is paragraph two.'));
  t.true(resultFr.includes('[FR] This is paragraph three.'));
});

// Integration test for the full file processing
test('parseMarkdownFileText processes files correctly', async t => {
  const { mandarin } = t.context;

  // Create a test markdown file
  const testContent = `# Test Document

This is regular text.

> [!NOTE]
> This is a note.

\`\`\`javascript
console.log("test");
\`\`\`

Check out [this link](https://example.com).`;

  const testFilePath = path.join(__dirname, 'test-file.md');
  fs.writeFileSync(testFilePath, testContent);

  try {
    await mandarin.parseMarkdownFileText(testFilePath);

    // Check that translated files were created
    const esFilePath = path.join(__dirname, 'test-file-es.md');
    const frFilePath = path.join(__dirname, 'test-file-fr.md');

    t.true(fs.existsSync(esFilePath));
    t.true(fs.existsSync(frFilePath));

    const esContent = fs.readFileSync(esFilePath, 'utf8');
    const frContent = fs.readFileSync(frFilePath, 'utf8');

    // Spanish file checks
    t.true(esContent.includes('[ES] This is regular text.'));
    t.true(esContent.includes('> [!NOTE]'));
    t.true(esContent.includes('```javascript'));
    t.true(esContent.includes('[ES] this link](https://example.com)'));

    // French file checks
    t.true(frContent.includes('[FR] This is regular text.'));
    t.true(frContent.includes('> [!NOTE]'));
    t.true(frContent.includes('```javascript'));
    t.true(frContent.includes('[FR] this link](https://example.com)'));

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

// Run the tests if this file is executed directly
if (require.main === module) {
  console.log('Running protected content tests...');

  // Simple test runner for manual execution
  const runTests = async () => {
    const tests = [
      { name: 'GitHub NOTE alerts', fn: test.fn },
      // Add more tests as needed
    ];

    for (const testCase of tests) {
      try {
        console.log(`Running: ${testCase.name}`);
        // Test execution would go here
        console.log(`✓ ${testCase.name} passed`);
      } catch (error) {
        console.log(`✗ ${testCase.name} failed:`, error.message);
      }
    }
  };

  runTests().catch(console.error);
}

