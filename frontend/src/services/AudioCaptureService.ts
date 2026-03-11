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
  private mediaRecorder: MediaRecorder | null = null;
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

      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000,
      });

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          this.handleAudioData(event.data);
        }
      };

      this.mediaRecorder.onstart = () => {
        this.onStatusCallback?.("recording");
      };

      this.mediaRecorder.onstop = () => {
        this.onStatusCallback?.("stopped");
      };

      this.mediaRecorder.onerror = (error) => {
        console.error("[AudioCapture] Recorder error:", error);
        this.onStatusCallback?.("error");
      };

      this.mediaRecorder.start(100);
    } catch (error) {
      console.error("[AudioCapture] Failed to start recording:", error);
      this.onStatusCallback?.("error");
      throw error;
    }
  }

  async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
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
    this.mediaRecorder = null;
  }

  async processWebmToPcm(blob: Blob): Promise<Uint8Array> {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.audioContext?.decodeAudioData(arrayBuffer);

    if (!audioBuffer) {
      throw new Error("Failed to decode audio data");
    }

    const channelData = audioBuffer.getChannelData(0);
    const pcmBuffer = new ArrayBuffer(audioBuffer.length * 2);
    const pcmView = new DataView(pcmBuffer);

    for (let i = 0; i < audioBuffer.length; i++) {
      const int16Value = Math.max(-1, Math.min(1, channelData[i])) * 0x7fff;
      pcmView.setInt16(i * 2, int16Value, true);
    }

    return new Uint8Array(pcmBuffer);
  }

  private handleAudioData(blob: Blob): void {
    this.processWebmToPcm(blob)
      .then((pcmData) => {
        this.onChunkCallback?.(pcmData);
      })
      .catch((error) => {
        console.error("[AudioCapture] Error processing audio:", error);
      });
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
    return this.mediaRecorder?.state === "recording" || false;
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
