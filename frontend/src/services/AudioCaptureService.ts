export interface AudioStreamConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  bufferSize: number;
}

export class AudioCaptureService {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private config: AudioStreamConfig;

  private onChunkCallback: ((chunk: Uint8Array) => void) | null = null;
  private onStatusCallback:
    | ((status: "recording" | "stopped" | "error") => void)
    | null = null;

  constructor(config: Partial<AudioStreamConfig> = {}) {
    this.config = {
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
      bitDepth: config.bitDepth || 16,
      bufferSize: config.bufferSize || 4096,
    };
  }

  async startRecording(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channels,
        },
        video: false,
      });

      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
      });
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;

      this.microphone = this.audioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.microphone.connect(this.analyser);

      const bufferSize = this.config.bufferSize;
      this.scriptProcessor = this.audioContext.createScriptProcessor(
        bufferSize,
        this.config.channels,
        this.config.channels,
      );

      this.scriptProcessor.onaudioprocess = (event) => {
        if (this.onChunkCallback) {
          const input = event.inputBuffer.getChannelData(0);
          const pcmBuffer = new ArrayBuffer(input.length * 2);
          const pcmView = new DataView(pcmBuffer);

          for (let i = 0; i < input.length; i++) {
            const int16Value = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
            pcmView.setInt16(i * 2, int16Value, true);
          }

          this.onChunkCallback(new Uint8Array(pcmBuffer));
        }
      };

      this.microphone.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      this.onStatusCallback?.("recording");
    } catch (error) {
      console.error("[AudioCapture] Failed to start recording:", error);
      this.onStatusCallback?.("error");
      throw error;
    }
  }

  async stopRecording(): Promise<void> {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }

    if (this.audioContext) {
      await this.audioContext.close();
    }

    this.mediaStream = null;
    this.audioContext = null;
    this.microphone = null;
    this.analyser = null;
    this.onStatusCallback?.("stopped");
  }

  onChunk(callback: (chunk: Uint8Array) => void): void {
    this.onChunkCallback = callback;
  }

  onStatus(
    callback: (status: "recording" | "stopped" | "error") => void,
  ): void {
    this.onStatusCallback = callback;
  }

  isRecording(): boolean {
    return this.scriptProcessor !== null;
  }

  getAudioLevel(): number {
    if (!this.analyser) return 0;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }

    return sum / dataArray.length / 255;
  }
}

export const audioCaptureService = new AudioCaptureService();
