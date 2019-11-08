const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const _ = require('lodash');
const pMapSeries = require('p-map-series');
const { v2 } = require('@google-cloud/translate');

const writeFile = promisify(fs.writeFile);

class Mandarin {
  constructor(config = {}) {
    this.config = {
      i18n: false,
      logger: console,
      clientConfig: {},
      ...config
    };

    if (!this.config.i18n) throw new Error('i18n instance option required');

    // setup google translate with api key
    this.client = new v2.Translate(this.config.clientConfig);

    this.translate = this.translate.bind(this);
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

    return pMapSeries(i18n.config.locales, async locale => {
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
        _.uniq(
          _.concat(_.values(i18n.config.phrases), _.values(defaultLocaleFile))
        ),
        _.values(file)
      );

      if (translationsRequired.length === 0) return file;

      // attempt to translate all of these in the given language
      await pMapSeries(translationsRequired, async phrase => {
        // TODO: prevent %s %d and %j from getting translated
        // <https://nodejs.org/api/util.html#util_util_format_format>
        // <https://github.com/nodejs/node/issues/17601>
        //
        // TODO: also prevent {{...}} from getting translated
        // by wrapping such with `<span class="notranslate">`?

        // get the translation results from Google
        const [translation] = await this.client.translate(phrase, locale);

        // replace `|` pipe character because translation will
        // interpret as ranged interval
        // <https://github.com/mashpie/i18n-node/issues/274>
        // TODO: maybe use `he` package to re-encode entities?
        file[phrase] = translation.replace(/\|/g, '&#124;');

        // write the file again
        await writeFile(filePath, JSON.stringify(file, null, 2));
      });

      return file;
    });
  }
}

module.exports = Mandarin;
