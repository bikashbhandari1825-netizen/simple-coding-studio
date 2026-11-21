/** "एप बनाइदेऊ / make an app / code लेखिदेऊ" जस्ता अनुरोध — requests to build or write something. */
export function wantsBuild(text: string): boolean {
  const t = text.toLowerCase();
  const verb =
    /\b(build|make|create|write|generate|develop|implement|give me)\b|बना|लेखिदे|लेख्दे|लेखेर दे|कोड (दे|देऊ|चाहिन्छ)|तयार/.test(
      t,
    );
  const thing =
    /\b(app|application|screen|page|ui|game|website|site|calculator|todo|clone|project|feature|login|form|widget|script|bot|api)\b|एप|ऐप|एपको|स्क्रिन|पेज|खेल|वेबसाइट|प्रोजेक्ट|कोड/.test(
      t,
    );
  return verb && thing;
}
