import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Git Protocol Integration', () => {
  it('should handle Git info/refs requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('001e# service=git-upload-pack\n0000', {
          headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' }
        })
    );
    const testUrl = 'https://example.com/gh/microsoft/vscode.git/info/refs?service=git-upload-pack';
    const response = await SELF.fetch(testUrl, {
      headers: {
        'User-Agent': 'git/2.34.1'
      }
    });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/microsoft/vscode.git/info/refs?service=git-upload-pack',
      expect.any(Object)
    );
  });

  it('should handle Git upload-pack requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('0000', {
          headers: { 'Content-Type': 'application/x-git-upload-pack-result' }
        })
    );
    const testUrl = 'https://example.com/gh/microsoft/vscode.git/git-upload-pack';
    const response = await SELF.fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-git-upload-pack-request',
        'User-Agent': 'git/2.34.1'
      },
      body: '0000' // Minimal Git protocol data
    });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/microsoft/vscode.git/git-upload-pack',
      expect.any(Object)
    );
  });

  it('should preserve Git-specific headers', async () => {
    const testUrl = 'https://example.com/gh/test/repo.git/info/refs';
    const response = await SELF.fetch(testUrl, {
      headers: {
        'User-Agent': 'git/2.34.1',
        'Git-Protocol': 'version=2'
      }
    });

    // Should not reject Git-specific headers
    expect(response.status).not.toBe(400);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
