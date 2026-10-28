import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export type FfprobeResult = {
  durationSeconds: number;
  metadata: Record<string, unknown>;
};

function runCommand(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}: ${stderr || stdout}`.trim(),
        ),
      );
    });
  });
}

export async function probeVideo(filePath: string): Promise<FfprobeResult> {
  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; [key: string]: unknown };
    streams?: unknown[];
  };
  const durationSeconds = parseFloat(parsed.format?.duration ?? '0') || 0;
  return {
    durationSeconds,
    metadata: {
      format: parsed.format ?? {},
      streams: parsed.streams ?? [],
    },
  };
}

export async function extractThumbnail(
  inputPath: string,
  durationSeconds: number,
): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamtube-thumb-'));
  const outputPath = path.join(tmpDir, 'thumb.jpg');
  const seek = durationSeconds > 2 ? Math.min(1, durationSeconds / 2) : 0;

  try {
    await runCommand('ffmpeg', [
      '-y',
      '-ss',
      String(seek),
      '-i',
      inputPath,
      '-vframes',
      '1',
      '-q:v',
      '2',
      outputPath,
    ]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function writeTempFile(
  buffer: Buffer,
  extension: string,
): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamtube-video-'));
  const filePath = path.join(tmpDir, `input.${extension}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.rm(dir, { recursive: true, force: true });
}
