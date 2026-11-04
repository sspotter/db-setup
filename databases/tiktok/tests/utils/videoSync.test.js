const { syncHiddenAcrossTables } = require('../../utils/videoSync');

describe('syncHiddenAcrossTables (per-project)', () => {
    let client;
    beforeEach(() => {
        client = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [{ project_id: 'p1' }, { project_id: 'p2' }] }) // project_posts
                .mockResolvedValueOnce({ rowCount: 1 }),                                       // tiktok_videos
        };
    });

    it('updates project_posts (never the shared posts row), scoped to the caller\'s projects', async () => {
        const out = await syncHiddenAcrossTables(client, 'v1', 7, true);

        expect(client.query).toHaveBeenCalledTimes(2); // one project_posts + one tiktok_videos statement
        const [postsSql, postsParams] = client.query.mock.calls[0];
        expect(postsSql).toMatch(/UPDATE project_posts ppo/);
        expect(postsSql).not.toMatch(/UPDATE posts/);
        expect(postsSql).toMatch(/proj\.user_id = \$2/);
        expect(postsSql).toMatch(/deleted_at = CASE WHEN \$3::boolean THEN ppo\.deleted_at ELSE NULL END/);
        expect(postsParams).toEqual(['v1', 7, true, null]);
        expect(out).toEqual({ posts: 2, videos: 1, projectIds: ['p1', 'p2'] });
    });

    it('limits both tables to the given projects', async () => {
        await syncHiddenAcrossTables(client, 'v1', 7, false, ['p1']);

        expect(client.query.mock.calls[0][1]).toEqual(['v1', 7, false, ['p1']]);
        const [videosSql, videosParams] = client.query.mock.calls[1];
        expect(videosSql).toMatch(/UPDATE tiktok_videos v/);
        expect(videosSql).toMatch(/v\.project_id = ANY\(\$4::uuid\[\]\)/);
        expect(videosParams).toEqual(['v1', 7, false, ['p1']]);
    });

    it('unhide passes false, which clears hidden_at and deleted_at in SQL', async () => {
        await syncHiddenAcrossTables(client, '123456', 'user-1', false);

        expect(client.query.mock.calls[0][1]).toEqual(['123456', 'user-1', false, null]);
        expect(client.query.mock.calls[0][0]).toMatch(/hidden_at = CASE WHEN \$3::boolean THEN CURRENT_TIMESTAMP ELSE NULL END/);
    });

    it('touches nothing for an empty project list', async () => {
        const out = await syncHiddenAcrossTables(client, 'v1', 7, true, []);

        expect(client.query).not.toHaveBeenCalled();
        expect(out).toEqual({ posts: 0, videos: 0, projectIds: [] });
    });
});
