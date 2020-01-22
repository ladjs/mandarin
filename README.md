# mandarin

[![build status](https://img.shields.io/travis/niftylettuce/mandarin.svg)](https://travis-ci.org/niftylettuce/mandarin)
[![code coverage](https://img.shields.io/codecov/c/github/niftylettuce/mandarin.svg)](https://codecov.io/gh/niftylettuce/mandarin)
[![code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![made with lass](https://img.shields.io/badge/made_with-lass-95CC28.svg)](https://lass.js.org)
[![license](https://img.shields.io/github/license/niftylettuce/mandarin.svg)](LICENSE)

> Automatic i18n markdown translation and i18n phrase translation using Google Translate

> **v2.0.0**: We have integrated Redis as a requirement for caching Google Translate responses (to save you money)
>
> **v1.0.0**: We now use the official Node.js Google Translate package `@google-cloud/translate`


## Table of Contents

* [Install](#install)
* [Requirements](#requirements)
* [Usage](#usage)
* [Contributors](#contributors)
* [License](#license)


## Install

[npm][]:

```sh
npm install mandarin
```

[yarn][]:

```sh
yarn add mandarin
```


## Requirements

You will need to have [Redis][] installed.


## Usage

1. Implement Mandarin and pass it an instance of [i18n][]

   ```js
   const Mandarin = require('mandarin');
   const I18N = require('@ladjs/i18n');

   const i18n = new I18N();

   // you can also pass a custom `logger` option (it defaults to `console`)
   const mandarin = new Mandarin({

    // REQUIRED:
    i18n

    // OPTIONAL:
    // logger: console,

    // OPTIONAL (see index.js for defaults):
    // redis: ...

    // OPTIONAL (see index.js for defaults):
    // redisMonitor: ...

    // OPTIONAL:
    // see all commented options from this following link:
    // <https://googleapis.dev/nodejs/translate/5.0.1/v2_index.js.html>
    //
    // clientConfig: {},

    // OPTIONAL (see index.js for defaults):
    // Files to convert from `index.md` to `index-es.md`
    // Or `README.md` to `README-ZH.md` for example
    // <https://github.com/sindresorhus/globby>
    //
    // markdown: ... (note we expose `Mandarin.DEFAULT_PATTERNS` for you)
   });

   //
   // Translate Phrases
   //
   // with async/await
   (async () => {
     try {
       await mandarin.translate();
     } catch (err) {
       console.log(err);
     }
   })();

   // with promises and then/catch
   mandarin
     .translate()
     .then(() => {
       console.log('done');
     })
     .catch(console.error);

   // with callbacks
   mandarin.translate(err => {
     if (err) throw err;
     console.log('done');
   });

   //
   // Translate Markdown Files
   //
   // with async/await
   (async () => {
     try {
       await mandarin.markdown();
     } catch (err) {
       console.log(err);
     }
   })();

   // with promises and then/catch
   mandarin
     .markdown()
     .then(() => {
       console.log('done');
     })
     .catch(console.error);

   // with callbacks
   mandarin.markdown(err => {
     if (err) throw err;
     console.log('done');
   });
   ```

2. This assumes that you have locale files already and a default locale file (e.g. `./locales/en.json` with phrases that need translated to other languages you support). Based off the defaults from [i18n][], you would automatically get your `en.json` file translated to the locales `es` (Spanish) and `zh` (Chinese).

3. Follow the "Before you begin" steps here <https://cloud.google.com/translate/docs/basic/setup-basic> (basically you download a JSON file after creating a Google Cloud Project with Cloud Translation API enabled).

4. Specify the path to the JSON file and run your script that uses `mandarin`:

```sh
GOOGLE_APPLICATION_CREDENTIALS="/home/user/Downloads/[FILE_NAME].json" node app.js
```


## Contributors

| Name           | Website                    |
| -------------- | -------------------------- |
| **Nick Baugh** | <http://niftylettuce.com/> |


## License

[MIT](LICENSE) © [Nick Baugh](http://niftylettuce.com/)


## 

[npm]: https://www.npmjs.com/

[yarn]: https://yarnpkg.com/

[i18n]: https://github.com/ladjs/i18n

[redis]: https://redis.io/
