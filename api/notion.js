export default async function handler(req, res) {
  const { NOTION_SECRET, DATABASE_ID } = process.env;
console.log("NOTION_SECRET:", NOTION_SECRET);
console.log("DATABASE_ID:", DATABASE_ID);

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Only GET allowed' });
  }

  try {
    const notionRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_SECRET}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ page_size: 100 }) // Optional filtering can go here
    });

    const data = await notionRes.json();

    if (!notionRes.ok) {
      return res.status(notionRes.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Notion Proxy Error:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
}
