// Generates fresh random samples every render quantum — there is no buffer
// and therefore no loop point, so the raw signal never repeats. All texture
// (filtering, envelopes, sparse events) is layered on top of this in JS.
class WhiteNoiseProcessor extends AudioWorkletProcessor {
  process(_inputs, outputs) {
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) {
      const data = output[channel];
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return true;
  }
}

registerProcessor("white-noise-processor", WhiteNoiseProcessor);
