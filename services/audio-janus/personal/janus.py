"""Internal Janus management client. Its credentials never leave the bridge."""
import asyncio
import secrets
import httpx


class Janus:
    def __init__(self, url, key):
        self.url, self.key = url.rstrip('/'), key
        self.client = httpx.AsyncClient(timeout=10)
        self.path = None
        self.lock = asyncio.Lock()

    async def post(self, path, body):
        response = await self.client.post(self.url + path, json={**body, 'transaction': secrets.token_hex(12)})
        response.raise_for_status()
        data = response.json()
        if data.get('janus') == 'error':
            raise RuntimeError('Janus signaling failed')
        return data

    async def message(self, body):
        async with self.lock:
            # Only synchronous management requests use this client. Retrying
            # create/destroy is reconciled by the caller via info on the next pass.
            try:
                if self.path is None:
                    session = (await self.post('', {'janus': 'create'}))['data']['id']
                    handle = (await self.post(f'/{session}', {'janus': 'attach', 'plugin': 'janus.plugin.streaming'}))['data']['id']
                    self.path = f'/{session}/{handle}'
                result = await self.post(self.path, {'janus': 'message', 'body': body})
                return result['plugindata']['data']
            except Exception:
                self.path = None
                raise

    async def info(self, mount):
        result = await self.message({'request': 'info', 'id': mount, 'secret': self.key})
        if result.get('error_code') == 455:  # no such mountpoint
            return None
        self.check(result)
        return result['info']

    @staticmethod
    def check(result):
        if result.get('error_code'):
            raise RuntimeError('Janus mount operation failed: ' + str(result.get('error_code')))
        return result

    async def create(self, mount, port, pin):
        return self.check(await self.message({
            'request': 'create', 'type': 'rtp', 'id': mount, 'description': 'Personal headphones',
            'is_private': True, 'secret': self.key, 'pin': pin, 'admin_key': self.key,
            'audio': True, 'video': False, 'audioport': port, 'audiopt': 111,
            'audiocodec': 'opus', 'audiofmtp': 'stereo=1;sprop-stereo=1',
        }))

    async def destroy(self, mount):
        if await self.info(mount) is not None:
            self.check(await self.message({'request': 'destroy', 'id': mount, 'secret': self.key}))

    async def close(self):
        if self.path:
            try:
                await self.post('/' + self.path.split('/')[1], {'janus': 'destroy'})
            except Exception:
                pass
        await self.client.aclose()
