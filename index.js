const fs = require('fs');
const path = require('path');
const process = require('process');
const { isIP } = require('net');

// const formatSpecifiers = require('format-specifiers');
const Redis = require('@ladjs/redis');
const _ = require('lodash');
// const autoLinkHeadings = require('remark-autolink-headings');
const debug = require('debug')('mandarin');
// const emoji = require('remark-emoji');
const globby = require('globby');
const isFQDN = require('is-fqdn');
const isSANB = require('is-string-and-not-blank');
const languages = require('@cospired/i18n-iso-languages');
const modifyFilename = require('modify-filename');
const pMap = require('p-map');
const pMapSeries = require('p-map-series');
const pify = require('pify');
const rehypeRaw = require('rehype-raw');
const rehypeRewrite = require('rehype-rewrite');
// const rehypeStringify = require('rehype-stringify');
const remarkParse = require('remark-parse');
const remarkPresetGitHub = require('remark-preset-github');
const remarkStringify = require('remark-stringify');
const remarkRehype = require('remark-rehype');
const revHash = require('rev-hash');
const sharedConfig = require('@ladjs/shared-config');
const slug = require('remark-slug');
const unified = require('unified');
const universalify = require('universalify');
const vfile = require('to-vfile');
const { v2 } = require('@google-cloud/translate');
const { isEmail, isURL } = require('validator');
const visit = require('unist-util-visit');

const isoCodes = Object.keys(languages.getAlpha2Codes());
const writeFile = pify(fs.writeFile);
const readFile = pify(fs.readFile);
const conf = _.pick(sharedConfig('MANDARIN'), [
  'logger',
  'redis',
  'redisMonitor'
]);

const DEFAULT_PATTERNS = [
  '**/*.md',
  '!*.md',
  ...isoCodes.map((code) => `!*-${code}.md`),
  ...isoCodes.map((code) => `!*-${code.toUpperCase()}.md`),
  ...isoCodes.map((code) => `!**/*-${code}.md`),
  ...isoCodes.map((code) => `!**/*-${code.toUpperCase()}.md`),
  '!test',
  '!coverage',
  '!node_modules'
];

function parsePreAndPostWhitespace(str) {
  const value = str.trim();
  const index = str.indexOf(value);
  return [str.slice(0, index), value, str.slice(index + value.length)];
}

// Custom plugin to add the {#id} syntax to the end of the heading text.
const addCustomIdToHeadingText = () => (tree) => {
  visit(tree, 'heading', (node) => {
    // `remark-slug` has already added the ID to `node.properties.id`.
    const slug = node.data?.id; // Use optional chaining for safety.

    if (slug) {
      // Append a new text node containing the custom ID syntax.
      node.children.push({
        type: 'text',
        value: ` {#${slug}}`
      });
    }
  });
};

// GitHub alert patterns
// const GITHUB_ALERT_PATTERNS = [
//   { pattern: /^>\s*\\?\[!NOTE\].*(?:\n>\s*.*)*$/g, type: 'NOTE' },
//   { pattern: /^>\s*\\?\[!TIP\].*(?:\n>\s*.*)*$/g, type: 'TIP' },
//   { pattern: /^>\s*\\?\[!IMPORTANT\].*(?:\n>\s*.*)*$/g, type: 'IMPORTANT' },
//   { pattern: /^>\s*\\?\[!WARNING\].*(?:\n>\s*.*)*$/g, type: 'WARNING' },
//   { pattern: /^>\s*\\?\[!CAUTION\].*(?:\n>\s*.*)*$/g, type: 'CAUTION' }
// ];
const GITHUB_ALERT_PATTERNS = [
  { pattern: /^>\s*\\?\[!NOTE\].*$/gm, type: 'NOTE' },
  { pattern: /^>\s*\\?\[!TIP\].*$/gm, type: 'TIP' },
  { pattern: /^>\s*\\?\[!IMPORTANT\].*$/gm, type: 'IMPORTANT' },
  { pattern: /^>\s*\\?\[!WARNING\].*$/gm, type: 'WARNING' },
  { pattern: /^>\s*\\?\[!CAUTION\].*$/gm, type: 'CAUTION' }
];

// Code block patterns
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;

// URL and link patterns - updated to handle hash links and both http/https
const URL_PATTERN = /(https?:\/\/[^\s\)]+|#[^\s\)]+)/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

// Table patterns
const TABLE_ROW_PATTERN = /^\|.*\|$/gm;
const TABLE_SEPARATOR_PATTERN = /^\|[-:\s]+\|$/gm;

class Mandarin {
  constructor(config = {}) {
    this.config = _.merge(
      {
        ..._.merge(conf, {
          redis: {
            keyPrefix: `mandarin_${(
              process.env.NODE_ENV || 'development'
            ).toLowerCase()}`
          }
        }),
        i18n: false,
        //
        // NOTE: you can pass `GOOGLE_APPLICATION_CREDENTIALS` as an environment variable
        //       or you can pass individual environment variables
        //
        // OPTIONAL:
        // see all commented options from this following link:
        // https://googleapis.dev/nodejs/translate/5.0.1/v2_index.js.html
        //
        clientConfig: {},
        //
        // Files to convert from `index.md` to `index-es.md`
        // Or `README.md` to `README-ZH.md` for example
        // https://github.com/sindresorhus/globby
        //
        markdown: {
          patterns: DEFAULT_PATTERNS,
          options: {
            gitignore: true
          }
        },
        //
        // Concurrency limit for parallel translations
        //
        concurrency: 5
      },
      config
    );

    debug(this.config);

    if (!this.config.i18n) throw new Error('i18n instance option required');

    // initialize redis
    this.redisClient =
      this.config.redis === false
        ? false
        : _.isPlainObject(this.config.redis)
        ? new Redis(
            this.config.redis,
            this.config.logger,
            this.config.redisMonitor
          )
        : this.config.redis;

    // setup google translate with api key
    this.client = new v2.Translate(this.config.clientConfig);

    this.translate = universalify.fromPromise(this.translate).bind(this);
    this.markdown = universalify.fromPromise(this.markdown).bind(this);
    this.parseMarkdownFile = universalify
      .fromPromise(this.parseMarkdownFile)
      .bind(this);
    this.getLocalizedMarkdownFileName = universalify
      .fromPromise(this.getLocalizedMarkdownFileName)
      .bind(this);
  }

  getLocalizedMarkdownFileName(filePath, locale) {
    debug('getLocalizedMarkdownFileName', filePath, locale);
    return modifyFilename(filePath, (filename, extension) => {
      const isUpperCase = filename.toUpperCase() === filename;
      return `${filename}-${
        isUpperCase ? locale.toUpperCase() : locale.toLowerCase()
      }${extension}`;
    });
  }

  // Helper method to detect and extract tables from content
  detectTables(content) {
    const lines = content.split('\n');
    const tables = [];
    let currentTable = null;
    let currentTableStart = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableRow = /^\|.*\|$/.test(line.trim());
      const isTableSeparator = /^\|[-:\s]+\|$/.test(line.trim());

      if (isTableRow || isTableSeparator) {
        if (!currentTable) {
          // Start of a new table
          currentTable = [];
          currentTableStart = i;
        }
        currentTable.push({ line, index: i, isHeader: isTableSeparator });
      } else if (currentTable) {
        // End of current table
        tables.push({
          rows: currentTable,
          startIndex: currentTableStart,
          endIndex: i - 1,
          originalText: lines.slice(currentTableStart, i).join('\n')
        });
        currentTable = null;
        currentTableStart = -1;
      }
    }

    // Handle table at end of content
    if (currentTable) {
      tables.push({
        rows: currentTable,
        startIndex: currentTableStart,
        endIndex: lines.length - 1,
        originalText: lines.slice(currentTableStart).join('\n')
      });
    }

    return tables;
  }

  // Helper method to translate table cells while preserving structure
  async translateTableCells(tableText, locale) {
    const lines = tableText.split('\n');
    const translatedLines = [];

    for (const line of lines) {
      if (/^\|[-:\s]+\|$/.test(line.trim())) {
        // This is a header separator line, keep it unchanged
        translatedLines.push(line);
        continue;
      }

      if (/^\|.*\|$/.test(line.trim())) {
        // This is a table row, translate the cell contents
        const cells = line.split('|').map(cell => cell.trim());
        const translatedCells = [];

        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];

          if (i === 0 || i === cells.length - 1) {
            // First and last elements are empty due to split on |
            translatedCells.push(cell);
          } else {
            // Translate cell content, but preserve inline code and links
            let cellContent = cell;

            // Protect inline code in cells
            const inlineCodeMatches = [];
            cellContent = cellContent.replace(INLINE_CODE_PATTERN, (match, offset) => {
              const placeholder = `__CELL_CODE_${inlineCodeMatches.length}__`;
              inlineCodeMatches.push(match);
              return placeholder;
            });

            // Protect links in cells
            const linkMatches = [];
            cellContent = cellContent.replace(MARKDOWN_LINK_PATTERN, (match, linkText, url) => {
              const placeholder = `__CELL_LINK_${linkMatches.length}__`;
              linkMatches.push({ match, linkText, url });
              return placeholder;
            });

            // Translate the cell content if it's not empty and not just whitespace
            if (cellContent.trim() && !cellContent.match(/^__\w+_\d+__$/)) {
              cellContent = await this.translateText(cellContent.trim(), locale);
            }

            // Restore protected content
            inlineCodeMatches.forEach((code, index) => {
              cellContent = cellContent.replace(`__CELL_CODE_${index}__`, code);
            });

            linkMatches.forEach((linkData, index) => {
              // Translate link text but keep URL
              const translatedLinkText = linkData.linkText; // Could translate this too if needed
              const restoredLink = `[${translatedLinkText}](${linkData.url})`;
              cellContent = cellContent.replace(`__CELL_LINK_${index}__`, restoredLink);
            });

            translatedCells.push(` ${cellContent} `);
          }
        }

        translatedLines.push(translatedCells.join('|'));
      } else {
        // Not a table line, keep unchanged
        translatedLines.push(line);
      }
    }

    return translatedLines.join('\n');
  }

  async translateMarkdownContent(content, locale) {
    debug('translateMarkdownContent', locale);

    // Store protected content that shouldn't be translated
    const protectedContent = new Map();
    let protectedIndex = 0;
    let processedContent = content;

    // Detect and protect tables first
    const tables = this.detectTables(content);
    const tableTranslations = new Map();

    // Process tables in parallel
    if (tables.length > 0) {
      const translatedTables = await pMap(
        tables,
        async (table) => ({
          ...table,
          translatedText: await this.translateTableCells(table.originalText, locale)
        }),
        { concurrency: this.config.concurrency }
      );

      // Replace tables with placeholders
      for (let i = translatedTables.length - 1; i >= 0; i--) {
        const table = translatedTables[i];
        const placeholder = `__PROTECTED_TABLE_${protectedIndex}__`;
        tableTranslations.set(placeholder, table.translatedText);
        protectedIndex++;

        // Replace the table in the content
        const lines = processedContent.split('\n');
        lines.splice(table.startIndex, table.endIndex - table.startIndex + 1, placeholder);
        processedContent = lines.join('\n');
      }
    }

    // Protect GitHub alerts - handle multi-line alerts properly
    GITHUB_ALERT_PATTERNS.forEach(({ pattern, type }) => {
      processedContent = processedContent.replace(pattern, (match) => {
        const placeholder = `__PROTECTED_ALERT_${type}_${protectedIndex}__`;
        protectedContent.set(placeholder, match);
        protectedIndex++;
        return placeholder;
      });
    });

    // Protect code blocks
    processedContent = processedContent.replace(CODE_BLOCK_PATTERN, (match) => {
      const placeholder = `__PROTECTED_CODE_BLOCK_${protectedIndex}__`;
      protectedContent.set(placeholder, match);
      protectedIndex++;
      return placeholder;
    });

    // Protect inline code
    processedContent = processedContent.replace(INLINE_CODE_PATTERN, (match) => {
      const placeholder = `__PROTECTED_INLINE_CODE_${protectedIndex}__`;
      protectedContent.set(placeholder, match);
      protectedIndex++;
      return placeholder;
    });

    // Protect URLs (but not those inside markdown links)
    processedContent = processedContent.replace(URL_PATTERN, (match, capturedUrl, offset, string) => {
      // Check if this URL is part of a markdown link
      const beforeMatch = string.substring(0, offset);
      const afterMatch = string.substring(offset + match.length);

      // Look for markdown link pattern around this URL
      const linkPattern = /\[[^\]]*\]\([^)]*$/;
      const isInMarkdownLink = linkPattern.test(beforeMatch) && afterMatch.startsWith(')');

      if (isInMarkdownLink) {
        return match; // Don't protect URLs inside markdown links
      }

      const placeholder = `__PROTECTED_URL_${protectedIndex}__`;
      protectedContent.set(placeholder, match);
      protectedIndex++;
      return placeholder;
    });

    // Handle markdown links - extract link text for translation
    const linkTranslations = new Map();

    processedContent = processedContent.replace(MARKDOWN_LINK_PATTERN, (match, linkText, url) => {
      const placeholder = `__PROTECTED_LINK_${protectedIndex}__`;
      linkTranslations.set(placeholder, { originalText: linkText, url, match });
      protectedIndex++;
      return placeholder;
    });

    // Split content into paragraphs for translation
    const paragraphs = processedContent.split(/\n\s*\n/);

    // Filter out empty paragraphs and protected-only content
    const paragraphsToTranslate = paragraphs
      .map((paragraph, index) => ({ text: paragraph.trim(), index }))
      .filter(({ text }) => {
        if (text === '') return false;
        // Check if paragraph contains only protected content
        if (text.match(/^__PROTECTED_\w+_\d+__$/)) return false;
        return true;
      });

    // Use p-map for parallel translation of paragraphs
    const translatedParagraphsData = await pMap(
      paragraphsToTranslate,
      async ({ text, index }) => ({
        text: await this.translateText(text, locale),
        index
      }),
      { concurrency: this.config.concurrency }
    );

    // Use p-map for parallel translation of link texts
    const linkTextTranslations = await pMap(
      Array.from(linkTranslations.entries()),
      async ([placeholder, linkData]) => ({
        placeholder,
        translatedText: await this.translateText(linkData.originalText, locale),
        url: linkData.url
      }),
      { concurrency: this.config.concurrency }
    );

    // Reconstruct paragraphs with translations
    const finalParagraphs = paragraphs.map((originalParagraph, index) => {
      const translatedData = translatedParagraphsData.find(data => data.index === index);
      return translatedData ? translatedData.text : originalParagraph;
    });

    let result = finalParagraphs.join('\n\n');

    // Reconstruct markdown links with translated text
    linkTextTranslations.forEach(({ placeholder, translatedText, url }) => {
      const reconstructedLink = `[${translatedText}](${url})`;
      result = result.replace(placeholder, reconstructedLink);
    });

    // Restore table translations
    tableTranslations.forEach((translatedTable, placeholder) => {
      result = result.replace(placeholder, translatedTable);
    });

    // Restore all other protected content
    protectedContent.forEach((originalContent, placeholder) => {
      result = result.replace(new RegExp(_.escapeRegExp(placeholder), 'g'), originalContent);
    });

    return result;
  }

  async translateText(text, locale) {
    if (!text || !text.trim()) return text;

    // Skip translation for certain patterns
    if (isEmail(text) || isFQDN(text) || isURL(text) || isIP(text)) {
      return text;
    }

    // Skip if text is all uppercase (likely abbreviations)
    if (text === text.toUpperCase()) {
      return text;
    }

    // Skip if text contains only protected placeholders
    if (text.match(/^__PROTECTED_\w+_\d+__$/)) {
      return text;
    }

    // Protect placeholders within text by temporarily replacing them
    const placeholderMap = new Map();
    let placeholderCounter = 0;

    // Find all placeholders in the text
    const placeholderPattern = /__PROTECTED_\w+_\d+__/g;
    let textToTranslate = text;

    // Replace placeholders with temporary safe tokens
    textToTranslate = textToTranslate.replace(placeholderPattern, (match) => {
      const tempToken = `TEMP_PLACEHOLDER_${placeholderCounter}`;
      placeholderMap.set(tempToken, match);
      placeholderCounter++;
      return tempToken;
    });

    // If the text is now empty or only contains temp tokens, don't translate
    if (!textToTranslate.trim() || textToTranslate.match(/^TEMP_PLACEHOLDER_\d+$/)) {
      return text;
    }

    // Check cache first
    const key = `${locale}:${revHash(textToTranslate)}`;
    let translation;

    if (this.redisClient) {
      translation = await this.redisClient.get(key);
    }

    if (!_.isString(translation)) {
      debug('getting translation for text:', textToTranslate.substring(0, 50) + '...');
      try {
        [translation] = await this.client.translate(textToTranslate, {
          to: locale,
          format: 'text'
        });
      } catch (err) {
        debug('translation error:', err);
        return text;
      }

      if (_.isString(translation)) {
        debug('got translation:', translation.substring(0, 50) + '...');
        if (this.redisClient) {
          await this.redisClient.set(key, translation);
        }
      }
    }

    if (_.isString(translation)) {
      // Restore the original placeholders
      placeholderMap.forEach((originalPlaceholder, tempToken) => {
        translation = translation.replace(new RegExp(tempToken, 'g'), originalPlaceholder);
      });

      return translation;
    }

    return text;
  }

  async parseMarkdownFile(filePath) {
    debug('parseMarkdownFile', filePath);

    // Original HTML-based implementation
    const markdown = await vfile.read(filePath);
    // don't translate the main file.md file, only for other locales
    const locales = this.config.i18n.config.locales.filter(
      (locale) => locale !== this.config.i18n.config.defaultLocale
    );

    const content = await new Promise((resolve, reject) => {
      unified()
        // <https://unifiedjs.com/learn/recipe/remark-html/#how-to-properly-support-html-inside-markdown>
        .use(remarkPresetGitHub)
        .use(remarkParse)
        .use(slug)
        /*
        .use(autoLinkHeadings, {
          behavior: 'prepend', // Use 'prepend' or 'append', but NOT 'wrap'.
          // The content for the new, separate link.
          content: {
            type: 'text',
            value: '🔗', // Using an emoji for the link content.
          },
          // Link properties can be added if needed, e.g., for CSS classes.
          properties: {
            ariaHidden: 'true',
            class: 'anchor'
          }
        })
        */
        .use(addCustomIdToHeadingText)
        .use(remarkStringify, {
          // Important: This option prevents the processor from escaping the `{` and `}`
          // characters in our custom ID.
          fences: true
        })
        .process(markdown, (err, file) => {
          if (err) return reject(err);
          resolve(String(file));
        });
    });

    await Promise.all(
      locales.map(async (locale) => {
        const localizedFilePath = this.getLocalizedMarkdownFileName(
          filePath,
          locale
        );
        let result = await this.translateMarkdownContent(content, locale);

        // Fix RTL reordering for headings with custom IDs
        result = result.replace(
          /^(.+?)\s+(#{1,6})\s+(\{#[^}]+\})$/gm,
          '$2 $1 $3'
        );

        // Fix RTL reordering for headings without custom IDs
        result = result.replace(
          /^(.+?)\s+(#{1,6})$/gm,
          '$2 $1'
        );

        // Fix custom IDs that are embedded within heading text
        result = result.replace(
          /^(#{1,6})\s+(.+?)(\{#[^}]+\})(.+?)$/gm,
          (match, hashes, beforeText, customId, afterText) => {
            // Remove any extra } characters and trim both parts
            const cleanAfterText = afterText.replace(/^}+/, '').trim();
            const cleanBeforeText = beforeText.trim();

            // Concatenate directly and normalize spaces
            const combinedText = `${cleanBeforeText}${cleanAfterText}`.replace(/\s+/g, ' ').trim();

            return `${hashes} ${combinedText} ${customId}`;
          }
        );

        debug('writing file', localizedFilePath);
        await writeFile(localizedFilePath, result);
      })
    );
  }

  async markdown() {
    // if title is all uppercase then `-EN` otherwise `-en`
    const filePaths = await globby(
      this.config.markdown.patterns,
      this.config.markdown.options
    );
    debug('markdown', filePaths);

    // Use p-map for parallel processing of markdown files
    await pMap(
      filePaths,
      (filePath) => this.parseMarkdownFile(filePath),
      { concurrency: this.config.concurrency }
    );
  }

  async translate() {
    const { i18n, logger } = this.config;

    const defaultFields = _.zipObject(
      _.values(i18n.config.phrases),
      _.values(i18n.config.phrases)
    );

    const defaultLocaleFilePath = path.join(
      i18n.config.directory,
      `${i18n.config.defaultLocale}.json`
    );

    let defaultLocaleFile;
    try {
      defaultLocaleFile = require(defaultLocaleFilePath);
    } catch (err) {
      logger.error(err);
      defaultLocaleFile = {};
    }

    // Use p-map for parallel translation of phrases
    return pMap(i18n.config.locales, async (locale) => {
      debug('locale', locale);
      const filePath = path.join(i18n.config.directory, `${locale}.json`);

      // look up the file, and if it does not exist, then
      // create it with an empty object
      let file;
      try {
        file = require(filePath);
      } catch (err) {
        logger.error(err);
        file = {};
      }

      // add any missing fields if they don't exist
      file = _.defaultsDeep(file, defaultFields);

      // if the locale is not the default
      // then check if translations need done
      if (locale === i18n.config.defaultLocale) return file;

      const translationsRequired = _.intersection(
        _.uniq([
          ..._.values(i18n.config.phrases),
          ..._.values(defaultLocaleFile)
        ]),
        _.values(file)
      );

      if (translationsRequired.length === 0) return file;

      debug('translationsRequired', translationsRequired);

      await pMap(
        translationsRequired,
        async (phrase) => {
          //
          // NOTE: note that this will corrupt `<a href="%s"`>`
          // so I have turned it off for now until we have a better parser
          //
          /*
          // prevent %s %d and %j from getting translated
          // <https://nodejs.org/api/util.html#util_util_format_format>
          // <https://github.com/nodejs/node/issues/17601>
          for (const element of formatSpecifiers) {
            safePhrase = safePhrase.replace(
              new RegExp(element, 'g'),
              `<span class="notranslate">${element}</span>`
            );
          }
          */

          debug('phrase', phrase);

          // NOTE: also prevent {{...}} from getting translated
          // by wrapping such with `<span class="notranslate">`?

          // lookup translation result from cache
          const key = `${locale}:${revHash(phrase)}`;
          let translation;

          // do not translate if it is an email, FQDN, URL, or IP
          if (isEmail(phrase) || isFQDN(phrase) || isURL(phrase) || isIP(phrase))
            translation = phrase;
          else if (this.redisClient)
            translation = await this.redisClient.get(key);
          debug('translation', translation);

          // get the translation results from Google
          if (!_.isString(translation)) {
            debug('getting translation', key, phrase);
            try {
              [translation] = await this.client.translate(phrase, {
                to: locale,
                format: 'text'
              });
            } catch (err) {
              debug('error', err, 'key', key, 'phrase', phrase, 'locale', locale);
            }

            if (_.isString(translation)) {
              debug('got translation', translation);
              if (this.redisClient) await this.redisClient.set(key, translation);
            }
          }

          // replace `|` pipe character because translation will
          // interpret as ranged interval
          // <https://github.com/mashpie/i18n-node/issues/274>
          // NOTE: maybe use `he` package to re-encode entities?
          if (_.isString(translation)) {
            file[phrase] = translation.replace(/\|/g, '&#124;');
          }
        }
      , { concurrency: this.config.concurrency });

      // write the file again
      debug('writing filePath', filePath);
      await writeFile(filePath, JSON.stringify(file, null, 2));

      return file;
    }, { concurrency: this.config.concurrency });
  }
}

Mandarin.parsePreAndPostWhitespace = parsePreAndPostWhitespace;

Mandarin.DEFAULT_PATTERNS = DEFAULT_PATTERNS;

module.exports = Mandarin;

