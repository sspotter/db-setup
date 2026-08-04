const { syncHiddenAcrossTables } = require('../../utils/videoSync');

describe('syncHiddenAcrossTables', () => {
    it('updates the owned posts row and every owned tiktok_videos row for the id', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

        await syncHiddenAcrossTables(client, '123456', 'user-1', true);

        expect(client.query).toHaveBeenCalledTimes(2);

        const [postsSql, postsParams] = client.query.mock.calls[0];
        expect(postsSql).toMatch(/UPDATE posts/);
        expect(postsParams).toEqual(['123456', 'user-1', true]);

        const [videosSql, videosParams] = client.query.mock.calls[1];
        expect(videosSql).toMatch(/UPDATE tiktok_videos/);
        expect(videosParams).toEqual(['123456', 'user-1', true]);
    });

    it('sets hidden_at to null and is_hidden to false on unhide', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

        await syncHiddenAcrossTables(client, '123456', 'user-1', false);

        const [, postsParams] = client.query.mock.calls[0];
        expect(postsParams).toEqual(['123456', 'user-1', false]);
    });
});
