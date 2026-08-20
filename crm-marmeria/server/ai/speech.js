const unavailable = (kind) => {
  const error = new Error(`${kind} non configurato: usa un provider locale compatibile.`);
  error.code = `${kind.toLowerCase()}_provider_unavailable`;
  error.status = 503;
  return error;
};

class SttProvider {
  async transcribe() { throw unavailable('STT'); }
}

class TtsProvider {
  async *synthesizeChunks() { throw unavailable('TTS'); }
}

module.exports = { SttProvider, TtsProvider };
