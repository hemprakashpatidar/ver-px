import crypto from 'crypto';

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { username, password } = req.body;
  const { NOTION_SECRET, USER_TABLE_ID } = process.env;

  // Hash the provided password
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

  try {
    // Get users from Notion database
    const users = await fetch(`https://api.notion.com/v1/databases/${USER_TABLE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_SECRET}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ page_size: 100 })
    });

    const usersData = await users.json();
    
    if (!users.ok) {
      return res.status(500).json({ 
        message: 'Database error. Please try again.' 
      });
    }

    // Find user by username
    const user = usersData.results.find(user => 
      user.properties.userName.title[0]?.plain_text === username
    );

    if (!user) {
      return res.status(401).json({ 
        message: 'Invalid credentials. Please check your username and password.' 
      });
    }

    // Get stored password from Notion
    const storedPassword = user.properties.password.rich_text[0]?.plain_text;

    // Compare hashed passwords
    if (hashedPassword !== storedPassword) {
      return res.status(401).json({ 
        message: 'Invalid credentials. Please check your username and password.' 
      });
    }
    // Return success response with user info
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        userName: user.properties.userName.title[0].plain_text,
        uuid: user.properties.uuid.rich_text[0]?.plain_text,
        isMe: !!user.properties.isMe.number
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ 
      message: 'Internal server error. Please try again.' 
    });
  }
} 
