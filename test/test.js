const path = require('path');

const I18N = require('@ladjs/i18n');
const Redis = require('ioredis-mock');
const del = require('del');
const delay = require('delay');
const test = require('ava');

const Mandarin = require('..');

test('translates a basic phrase to multiple languages', async (t) => {
  await del(path.join(__dirname, '..', 'locales'));
  const i18n = new I18N({ autoReload: true });
  const hello = i18n.api.t({ phrase: 'Hello', locale: 'en' });
  t.is(hello, 'Hello');
  const mandarin = new Mandarin({ i18n, redis: new Redis() });
  await mandarin.translate();
  // allow auto-reload to occur
  await delay(1000);
  t.is(i18n.api.t({ phrase: 'Hello', locale: 'es' }), 'Hola');
});
