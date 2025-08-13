import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";
import fs from "fs";

const WATCHLIST = ["NVDA","GOOGL","MSFT","ORCL","CSCO","AMD","SNOW","META","CRWD","DUK","WM","NEE","ED","RSG","COST","PG"];
const FEEDS = [
  "https://www.reuters.com/markets/us/rss",
  "https://www.reuters.com/markets/asia/rss",
  "https://www.reuters.com/world/asia-pacific/rss",
  "https://www.reuters.com/technology/rss",
  "https://www.reuters.com/world/rss",
  "https://www.reuters.com/world/us/rss",
  "https://www.reuters.com/world/europe/rss",
  "https://www.reuters.com/world/middle-east/rss",
  "https://apnews.com/apf-topnews&format=xml",
  "https://apnews.com/hub/business?format=xml",
  "https://apnews.com/hub/world-news?format=xml",
  "https://apnews.com/hub/politics?format=xml",
  "https://feeds.marketwatch.com/marketwatch/topstories/",
  "https://feeds.marketwatch.com/marketwatch/marketpulse/",  // ADDED MISSING COMMA
  "https://www.federalreserve.gov/feeds/press_all.xml",
  "https://home.treasury.gov/news/press-releases/rss",
  "https://ustr.gov/about-us/policy-offices/press-office/press-releases.rss"
];

const MAX_ITEMS = 25, RECENT_HOURS = 12;
const now = new Date();
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "text" });

const ageH = d => (now - new Date(d)) / 36e5;
function uniqBy(a, keyFn){ const s=new Set(); return a.filter(x=>{const k=keyFn(x); if(s.has(k)) return false; s.add(k); return true;}); }

function classifyImpact(text){
  const t = text.toLowerCase();
  const bull = ["beat","beats","above expectations","raises guidance","surge","rallies","soars","record high","cuts tariffs","stimulus","acquisition","buyback","dividend increase","approval","eases","cooling inflation"].some(k=>t.includes(k));
  const bear = ["miss","misses","below expectations","cuts guidance","plunge","falls","sinks","profit warning","sanctions","tariff","lawsuit","regulatory probe","bankruptcy","strike","hot inflation"].some(k=>t.includes(k));
  if (bull && !bear) return { impact:"Bullish", confidence:3 };
  if (bear && !bull) return { impact:"Bearish", confidence:3 };
  if (t.includes("cpi") || t.includes("inflation") || t.includes("jobs")) return { impact:"Neutral", confidence:3 };
  return { impact:"Neutral", confidence:2 };
}
const affected = text => WATCHLIST.filter(t => text.toUpperCase().includes(t));

async function getFeed(url){
  try {
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) {
      console.warn(`Feed failed: ${url} - Status: ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const j = parser.parse(xml);
    const channel = j.rss?.channel || j.feed || {};
    let items = channel.item || channel.entry || [];
    if (!Array.isArray(items)) items = [items];
    return items.filter(Boolean).map(x=>{
      const title = (x.title?.text || x.title || "").trim();
      const link = x.link?.["@_href"] || x.link?.text || x.link || x.guid?.text || "";
      const desc = (x.description?.text || x.description || x.summary?.text || "").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
      const pub = x.pubDate || x.published || x.updated || now.toISOString();
      return { title, link, desc, pubDate: new Date(pub).toISOString() };
    });
  } catch (error) {
    console.warn(`Feed error: ${url} - ${error.message}`);
    return [];
  }
}

(async()=>{
  console.log("Starting data collection...");
  let all = [];
  for (const f of FEEDS){ 
    try{ 
      const items = await getFeed(f);
      all.push(...items);
      console.log(`Fetched ${items.length} items from ${f}`);
    } catch(e){ 
      console.error("Feed error:", f, e.message); 
    } 
  }
  
  all = all
    .filter(x=>x.title && x.link && ageH(x.pubDate) <= RECENT_HOURS)
    .map(x=>{
      const text = `${x.title}. ${x.desc}`;
      const cls = classifyImpact(text);
      const ticks = affected(text);
      const score = (12 - Math.min(12, ageH(x.pubDate))) + (ticks.length?3:0) + (cls.impact!=="Neutral"?1:0);
      return {...x, ...cls, ticks, score};
    })
    .sort((a,b)=>b.score-a.score);
  all = uniqBy(all, x=>x.title+"|"+x.link);

  const items = all.slice(0, MAX_ITEMS).map(x=>({
    ts: x.pubDate,
    headline: x.title,
    url: x.link,
    impact: x.impact,
    confidence: x.confidence,
    affected: x.ticks.length ? x.ticks : ["INDEX/SECTOR"],
    summary_en: x.desc || x.title,
    next_en: "Next: watch scheduled data (CPI/Jobs/Fed) or company guidance."
  }));

  const out = { last_updated: now.toISOString(), items };
  fs.writeFileSync("data.json", JSON.stringify(out, null, 2));
  console.log(`Successfully wrote data.json with ${items.length} items.`);
})().catch(error => {
  console.error("Script failed:", error);
  process.exit(1);
});
