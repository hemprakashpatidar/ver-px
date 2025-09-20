import crypto from 'crypto';

export default async function handler(req, res) {
  const { username, password } = req.body;
  const { NOTION_SECRET, USER_TABLE_ID } = process.env;

  // Generate random UUID
  const uuid = crypto.randomUUID();
  
  // Hash the password
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

  const users = await fetch(`https://api.notion.com/v1/databases/${USER_TABLE_ID}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_SECRET}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page_size: 100 })
  });
  const usersRes = await users.json();
  // check if user already exists
  const user = usersRes.results.find(user => user.properties.userName.title[0].plain_text === username);
  if (user) {
    return res.status(400).json({ message: 'User already exists' });
  }
  // create user
  const newUser = await fetch(`https://api.notion.com/v1/pages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_SECRET}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ 
      parent: { database_id: USER_TABLE_ID },
      properties: { 
        userName: { title: [{ text: { content: username } }] },
        password: { rich_text: [{ text: { content: hashedPassword } }] },
        uuid: { rich_text: [{ text: { content: uuid } }] }
      } 
    })
  });
  // check if user created
  const newUserRes = await newUser.json();
  if (newUserRes.id) {
    return res.status(200).json({ message: 'User created' });
  }
  return res.status(400).json({ message: 'User not created' }); 
 

}