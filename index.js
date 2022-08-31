const fs = require('fs');
const path = require('path');
const process = require('process');

// const formatSpecifiers = require('format-specifiers');
const Redis = require('@ladjs/redis');
const _ = require('lodash');
const autoLinkHeadings = require('remark-autolink-headings');
const debug = require('debug')('mandarin');
const emoji = require('remark-emoji');
const globby = require('globby');
const isSANB = require('is-string-and-not-blank');
const languages = require('@cospired/i18n-iso-languages');
const modifyFilename = require('modify-filename');
const pMapSeries = require('p-map-series');
const pify = require('pify');
const rehypeRaw = require('rehype-raw');
const rehypeRewrite = require('rehype-rewrite');
const rehypeStringify = require('rehype-stringify');
const remarkParse = require('remark-parse');
const remarkPresetGitHub = require('remark-preset-github');
const remarkRehype = require('remark-rehype');
const revHash = require('rev-hash');
const sharedConfig = require('@ladjs/shared-config');
const slug = require('remark-slug');
const unified = require('unified');
const universalify = require('universalify');
const vfile = require('to-vfile');
const { v2 } = require('@google-cloud/translate');

const isoCodes = Object.keys(languages.getAlpha2Codes());
const writeFile = pify(fs.writeFile);
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
        }
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

  async parseMarkdownFile(filePath) {
    debug('parseMarkdownFile', filePath);
    const markdown = await vfile.read(filePath);
    // don't translate the main file.md file, only for other locales
    const locales = this.config.i18n.config.locales.filter(
      (locale) => locale !== this.config.i18n.config.defaultLocale
    );
    const files = await Promise.all(
      locales.map((locale) => {
        return new Promise((resolve, reject) => {
          unified()
            // <https://unifiedjs.com/learn/recipe/remark-html/#how-to-properly-support-html-inside-markdown>
            .use(remarkPresetGitHub)
            .use(remarkParse)
            .use(slug)
            .use(autoLinkHeadings, {
              behavior: 'prepend',
              content: {
                type: 'element',
                tagName: 'i',
                properties: {
                  className: ['fa', 'fa-link', 'mr-2', 'text-dark']
                },
                children: []
              }
            })
            .use(emoji)
            .use(remarkRehype, { allowDangerousHtml: true })
            .use(rehypeRaw)
            .data('settings', { fragment: true, emitParseErrors: true })
            .use(rehypeRewrite, (node, index, parent) => {
              if (
                locale !== 'en' &&
                node.type === 'text' &&
                parent.tagName !== 'code' &&
                isSANB(node.value) &&
                node.value !== node.value.toUpperCase()
              ) {
                // if the `parent.tagName` is `code`
                // or if the `node.value` is empty string (and not just \n either)
                // or if the `node.value` when converted to uppercase is the same (e.g. abbreviation)
                // then do not translate the value using i18n
                // otherwise translate the value and set the new node value
                //
                // NOTE: we must strip the preceeding and succeeding whitespace and line breaks
                //       and then add them back after the string is successfully translated
                //
                const [pre, phrase, post] = parsePreAndPostWhitespace(
                  node.value
                );
                node.value =
                  pre +
                  this.config.i18n.api.t({
                    phrase,
                    locale
                  }) +
                  post;
              }
            })
            .use(rehypeStringify)
            .process(markdown, (err, file) => {
              if (err) return reject(err);
              resolve({ locale, content: String(file) });
            });
        });
      })
    );
    await Promise.all(
      files.map(async (file) => {
        const localizedFilePath = this.getLocalizedMarkdownFileName(
          filePath,
          file.locale
        );
        debug('writing file', localizedFilePath);
        await writeFile(localizedFilePath, file.content);
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
    await Promise.all(
      filePaths.map((filePath) => this.parseMarkdownFile(filePath))
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

    return pMapSeries(i18n.config.locales, async (locale) => {
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

      // attempt to translate all of these in the given language
      await pMapSeries(translationsRequired, async (phrase) => {
        const safePhrase = phrase;
        //
        // TODO: note that this will corrupt `<a href="%s"`>`
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
        debug('safePhrase', safePhrase);

        // TODO: also prevent {{...}} from getting translated
        // by wrapping such with `<span class="notranslate">`?

        // lookup translation result from cache
        const key = `${locale}:${revHash(phrase)}`;
        let translation;
        if (this.redisClient) translation = await this.redisClient.get(key);
        debug('translation', translation);

        // get the translation results from Google
        if (!_.isString(translation)) {
          debug('getting translation', key);
          [translation] = await this.client.translate(safePhrase, locale);
          debug('got translation', translation);
          if (this.redisClient) await this.redisClient.set(key, translation);
        }

        // replace `|` pipe character because translation will
        // interpret as ranged interval
        // <https://github.com/mashpie/i18n-node/issues/274>
        // TODO: maybe use `he` package to re-encode entities?
        file[phrase] = translation.replace(/\|/g, '&#124;');

        // write the file again
        debug('writing filePath', filePath, 'with translation', translation);
        await writeFile(filePath, JSON.stringify(file, null, 2));
      });

      return file;
    });
  }
}

Mandarin.parsePreAndPostWhitespace = parsePreAndPostWhitespace;

Mandarin.DEFAULT_PATTERNS = DEFAULT_PATTERNS;

module.exports = Mandarin;
