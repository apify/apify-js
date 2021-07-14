export const staticAttributePatterns = {
    username: [
        {
            attribute: 'type',
            value: 'email'
        }
    ]
};

export const otherAttributePatterns = {
    attributes: [
        'id',
        'name',
        'class'
    ],
    value: {
        username: [
            'username',
            'email',
            'user'
        ],
        // password: [
        //     'password',
        //     'pwd',
        //     'pass'
        // ]
    },
};
