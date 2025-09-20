export const getDatabaseId = (type, isMe) => {
    const { MY_DATABASE_ID, MY_DATABASE_ID_CC, TXN_DATABASE_ID } = process.env;
    if (isMe && type === 'cc') {
        return MY_DATABASE_ID_CC;
    }
    else if (isMe) {
        return MY_DATABASE_ID;
    }
    else return TXN_DATABASE_ID;
}

export const buildNotionFilter = (uuid, userName) => {
    // Check that both uuid and userName are present
    if (!uuid || !userName) {
        throw new Error('Both uuid and userName are required for filtering');
    }
    
    const filter = {
        and: [
            {
                property: "uuid",
                rich_text: {
                    equals: uuid
                }
            },
            {
                property: "userName",
                title: {
                    equals: userName
                }
            }
        ]
    };

    return filter;
}