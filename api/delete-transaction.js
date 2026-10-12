export default async function handler(req, res) {
    const { NOTION_SECRET } = process.env;
    const { uuid, userName } = req.user;
    const { pageId } = req.body;
  
    // Validate required fields
    if (!pageId) {
      return res.status(400).json({
        message: 'Missing required field: pageId'
      });
    }
  
    if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(pageId)) {
      return res.status(400).json({ message: 'Invalid pageId' });
    }

    try {
      // Verify the page belongs to this user before deleting
      const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${NOTION_SECRET}`,
          'Notion-Version': '2022-06-28'
        }
      });
  
      if (!pageRes.ok) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
  
      const page = await pageRes.json();
  
      // Security check: make sure the page's uuid matches the requesting user
      const pageUuid = page.properties?.uuid?.rich_text?.[0]?.plain_text;
      const pageUserName = page.properties?.userName?.rich_text?.[0]?.plain_text;
  
      if (pageUuid !== uuid || pageUserName !== userName) {
        return res.status(403).json({
          message: 'Forbidden: you do not own this transaction'
        });
      }
  
      // Archive (soft-delete) the Notion page
      const deleteRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${NOTION_SECRET}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ archived: true })
      });
  
      const deleteData = await deleteRes.json();
  
      if (!deleteRes.ok) {
        console.error('Notion delete error:', deleteData);
        return res.status(deleteRes.status).json({
          message: 'Failed to delete transaction'
        });
      }
  
      return res.status(200).json({
        success: true,
        message: 'Transaction deleted successfully',
        pageId
      });
  
    } catch (error) {
      console.error('Delete Transaction Error:', error);
      return res.status(500).json({
        message: 'Internal Server Error'
      });
    }
  }