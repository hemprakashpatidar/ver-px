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

export const buildNotionFilter = (uuid, userName, startDate, endDate) => {
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
            },
            {
                property: 'Date',
                date: {
                  on_or_after: startDate
                }
              },
              {
                property: 'Date',
                date: {
                  before: endDate
                }
              }
        ]
    };

    return filter;
}

export const getMonthFilterConfig = (month, year) => {
    // Ensure month is 2-digit format (e.g., '03' for March)
const monthStr = String(month).padStart(2, '0');

// Start of month
const startDate = `${year}-${monthStr}-01`;

// Get start of next month
const nextMonth = month === 12 ? 1 : month + 1;
const nextYear = month === 12 ? year + 1 : year;
const nextMonthStr = String(nextMonth).padStart(2, '0');
const endDate = `${nextYear}-${nextMonthStr}-01`;
return {
    startDate, endDate
}
}