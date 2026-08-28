/**
 * Consumer mailbox providers. Not invalid — plenty of real enquiries come from
 * a personal address — but a strong signal that this is not a company contact.
 */
export const FREE_EMAIL_PROVIDERS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "yahoo.fr", "yahoo.de", "yahoo.es",
  "ymail.com", "rocketmail.com",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.it", "hotmail.de",
  "outlook.com", "outlook.co.uk", "live.com", "live.co.uk", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aim.com",
  "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.de", "gmx.net", "web.de",
  "zoho.com", "zohomail.com",
  "mail.com", "email.com", "usa.com",
  "yandex.com", "yandex.ru", "ya.ru",
  "qq.com", "163.com", "126.com", "sina.com", "foxmail.com",
  "naver.com", "daum.net", "hanmail.net",
  "rediffmail.com",
  "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "onet.pl",
  "libero.it", "virgilio.it", "tiscali.it", "alice.it",
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr",
  "bol.com.br", "uol.com.br", "terra.com.br",
  "t-online.de", "freenet.de",
  "btinternet.com", "sky.com", "talktalk.net", "virginmedia.com",
  "bigpond.com", "optusnet.com.au",
  "shaw.ca", "rogers.com", "sympatico.ca",
  "fastmail.com", "hushmail.com", "tutanota.com", "tuta.io",
]);

export function isFreeProvider(domain: string): boolean {
  return FREE_EMAIL_PROVIDERS.has(domain.toLowerCase());
}
