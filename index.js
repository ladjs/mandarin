const path = require('path');
const { promisify } = require('util');
const autoBind = require('auto-bind');
const fs = require('fs-extra');
const GoogleTranslate = require('google-translate');
const _ = require('lodash');

class Mandarin {
  constructor(config = {}) {
    this.config = Object.assign(
      {
        i18n: false,
        logger: console
      },
      config
    );

    if (!this.config.i18n) throw new Error('i18n instance option required');

    // setup google translate with api key
    this.googleTranslate = new GoogleTranslate(
      process.env.GOOGLE_TRANSLATE_KEY
    );

    // convert to a promise the translation function
    this.translateFn = promisify(this.googleTranslate.translate).bind(
      this.googleTranslate
    );

    // store our timeouts in an array
    this._timeouts = [];

    autoBind(this);
  }

  translate(job, fn) {
    if (_.isFunction(job)) fn = job;

    const { i18n, logger } = this.config;

    const defaultFields = _.zipObject(
      _.values(i18n.config.phrases),
      _.values(i18n.config.phrases)
    );

    const defaultLocaleFilePath = path.join(
      i18n.config.directory,
      `${i18n.config.defaultLocale}.json`
    );

    const promise = new Promise(async (resolve, reject) => {
      let defaultLocaleFile;
      try {
        defaultLocaleFile = require(defaultLocaleFilePath);
      } catch (err) {
        logger.error(err);
        defaultLocaleFile = {};
      }

      try {
        await Promise.all(
          i18n.config.locales.map(locale => {
            logger.debug(`checking locale of "${locale}"`);
            return new Promise(async (resolve, reject) => {
              const filePath = path.join(
                i18n.config.directory,
                `${locale}.json`
              );

              // look up the file, and if it does not exist, then
              // create it with an empty object
              let file;
              try {
                file = require(filePath);
              } catch (err) {
                file = {};
              }

              // add any missing fields if they don't exist
              file = _.defaultsDeep(file, defaultFields);

              // if the locale is not the default
              // then check if translations need done
              if (locale !== i18n.config.defaultLocale) {
                const translationsRequired = _.intersection(
                  _.uniq(
                    _.concat(
                      _.values(i18n.config.phrases),
                      _.values(defaultLocaleFile)
                    )
                  ),
                  _.values(file)
                );

                if (translationsRequired.length > 0)
                  logger.debug(
                    `translating (${
                      translationsRequired.length
                    }) phrases in ${locale}`
                  );

                // attempt to translate all of these in the given language
                const promises = _.map(translationsRequired, phrase => {
                  // TODO: prevent %s %d and %j from getting translated
                  // <https://nodejs.org/api/util.html#util_util_format_format>
                  // <https://github.com/nodejs/node/issues/17601>
                  //
                  // TODO: also prevent {{...}} from getting translated
                  // by wrapping such with `<span class="notranslate">`?

                  // TODO: what should this be instead of 20s?
                  // only give the Google API a few seconds to finish
                  return Promise.race([
                    new Promise(resolve => {
                      const timeout = setTimeout(() => {
                        logger.warn(
                          'google translate API did not respond in 20s'
                        );
                        resolve();
                      }, 20000);
                      this._timeouts.push(timeout);
                    }),
                    this.translateFn(phrase, locale)
                  ]);
                });

                // get the translation results from Google
                let error;
                try {
                  const results = await Promise.all(promises);
                  _.each(_.compact(results), result => {
                    // replace `|` pipe character because translation will
                    // interpret as ranged interval
                    // <https://github.com/mashpie/i18n-node/issues/274>
                    // TODO: maybe use `he` package to re-encode entities?
                    file[result.originalText] = result.translatedText.replace(
                      /\|/g,
                      '&#124;'
                    );
                  });
                } catch (err) {
                  error = err;
                  if (
                    !_.isError(err) &&
                    _.isObject(err) &&
                    _.isObject(err.response) &&
                    _.isString(err.response.body)
                  ) {
                    const body = JSON.parse(err.response.body);
                    if (
                      _.isObject(body) &&
                      _.isObject(body.error) &&
                      _.isString(body.error.message)
                    )
                      error = new Error(body.error.message);
                  }
                } finally {
                  // clear and reset all timeouts
                  this._timeouts.forEach(timeout => {
                    clearTimeout(timeout);
                  });
                  this._timeouts = [];
                }
                if (error) return reject(error);
              }

              // write the file again
              try {
                await fs.writeFile(filePath, JSON.stringify(file, null, 2));
                resolve();
              } catch (err) {
                reject(err);
              }
            });
          })
        );

        resolve();
      } catch (err) {
        reject(err);
      }
    });

    if (_.isFunction(fn)) promise.then(() => fn()).catch(fn);
    else return promise;
  }
}

module.exports = Mandarin;
