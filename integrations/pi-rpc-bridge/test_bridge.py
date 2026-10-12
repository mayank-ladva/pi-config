import asyncio
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
import server as b

class StubPi:
    def __init__(self, job, mode='normal'):
        self.job, self.mode, self.closing = job, mode, False
        self.proc = None
    async def call(self, kind, **kwargs):
        if kind == 'get_state':
            return {'isStreaming': False, 'pendingMessageCount':0}
        if self.mode == 'handled':
            return {'disposition':'handled'}
        if self.mode == 'normal':
            self.job.event({'type':'agent_end'})
            asyncio.get_running_loop().call_later(.05, self.job.event, {'type':'agent_settled'})
        return {'disposition':'started'}
    async def close(self):
        self.closing = True
    async def write(self, record):
        self.response = record

class Tests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = patch.object(b, 'STATE', Path(self.tmp.name))
        self.state.start()
    def tearDown(self):
        b.JOBS.clear()
        self.state.stop()
        self.tmp.cleanup()
    def job(self, mode='normal', seconds=1):
        j = b.Job(self.tmp.name, 'test', None, False, seconds)
        j.pi = StubPi(j, mode)
        return j
    def test_free_scope_rejects_paid_unknown_and_missing_cost(self):
        def model(name, provider='kilocode', cost=0):
            return {'provider':provider, 'id':name, 'cost':dict.fromkeys(b.COST_KEYS,cost)}
        models = [model('x:free'), model('paid'), model('gpt', 'openai-codex'),
                  model('bad:free',cost=1), {'provider':'kilocode','id':'missing:free'}]
        self.assertEqual([m['id'] for m in b.free_models(models,['*'])], ['x:free'])
        self.assertEqual(b.free_models(models,[]), [])
    async def test_waits_for_settled_not_agent_end(self):
        j = self.job()
        task = asyncio.create_task(j.turn('test'))
        await asyncio.sleep(.01)
        self.assertEqual(j.status,'running')
        await task
        self.assertEqual(j.status,'done')
    async def test_handled_prompt_does_not_hang(self):
        j = self.job('handled')
        await j.turn('/task-status')
        self.assertEqual(j.status,'done')
    async def test_deadline_closes_pi(self):
        j = self.job('hang', .01)
        await j.turn('test')
        self.assertEqual(j.status,'expired')
        self.assertTrue(j.pi.closing)
    async def test_dialog_requires_reply_and_validates_option(self):
        j = self.job()
        b.JOBS[j.id] = j
        j.event({'type':'extension_ui_request','id':'dialog','method':'select','options':['Allow','Block']})
        self.assertEqual(j.status,'needs_input')
        with self.assertRaises(ValueError):
            await b.tool('pi_respond',{'job_id':j.id,'request_id':'dialog','value':'yes'})
        await b.tool('pi_respond',{'job_id':j.id,'request_id':'dialog','value':'Block'})
        self.assertEqual(j.pi.response['value'],'Block')
    async def test_expired_dialog_cannot_be_approved(self):
        j = self.job()
        b.JOBS[j.id] = j
        j.event({'type':'extension_ui_request','id':'d','method':'confirm','timeout':0})
        with self.assertRaises(ValueError):
            await b.tool('pi_respond',{'job_id':j.id,'request_id':'d','confirmed':True})
    def test_quota_failure_stops_without_global_setting_changes(self):
        j = self.job()
        j.event({'type':'message_end','message':{'role':'assistant','stopReason':'error','errorMessage':'429 quota exhausted'}})
        self.assertEqual(j.status,'error')
        self.assertTrue(j.settled.is_set())
    async def test_restart_reports_interruption(self):
        j = self.job()
        j.status = 'running'
        j.save()
        saved = await b.tool('pi_status',{'job_id':j.id})
        self.assertEqual(saved['status'],'interrupted')
        self.assertFalse(saved['session_alive'])
    async def test_job_path_traversal_rejected(self):
        with self.assertRaises(ValueError):
            await b.tool('pi_status',{'job_id':'../../settings'})
    async def test_followup_keeps_session_and_completes(self):
        j = self.job()
        j.status = 'done'
        j.pi.proc = SimpleNamespace(returncode=None)
        b.JOBS[j.id] = j
        result = await b.tool('pi_message', {'job_id':j.id,'message':'follow-up'})
        self.assertEqual(result['status'], 'running')
        await j.followup_task
        self.assertEqual(j.status, 'done')
    async def test_followup_rejects_conflicting_workspace_job(self):
        j = self.job()
        j.status = 'done'
        j.pi.proc = SimpleNamespace(returncode=None)
        other = self.job()
        other.status = 'running'
        b.JOBS.update({j.id:j, other.id:other})
        with self.assertRaises(RuntimeError):
            await b.tool('pi_message', {'job_id':j.id,'message':'follow-up'})
    async def test_transport_preserves_unicode_and_response_ids(self):
        fake = Path(self.tmp.name) / 'pi'
        fake.write_text('''#!/usr/bin/python3
import sys,json
for line in sys.stdin.buffer:
 r=json.loads(line)
 print(json.dumps({'type':'response','id':r['id'],'success':True,'data':{'text':'a\\u2028b\\u2029c'}},ensure_ascii=False),flush=True)
''')
        fake.chmod(0o700)
        with patch.dict(b.os.environ, {'PI_BINARY':str(fake)}):
            pi = b.Pi(self.tmp.name)
            try:
                await pi.start()
                values = await asyncio.gather(pi.call('one'),pi.call('two'))
                self.assertEqual(values,[{'text':'a\u2028b\u2029c'}]*2)
            finally:
                await pi.close()

if __name__ == '__main__':
    unittest.main()
