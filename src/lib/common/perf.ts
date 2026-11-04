import GLib from 'gi://GLib';

/**
 * Lightweight performance instrumentation.
 *
 * Disabled unless the environment variable COPYOUS_PERF is set for gnome-shell.
 * When enabled it logs slow spans and periods where the main loop was blocked,
 * which on GNOME Shell means the whole desktop was frozen.
 */
const ENABLED = !!GLib.getenv('COPYOUS_PERF');
const VERBOSE = GLib.getenv('COPYOUS_PERF') === '2';
const SPAN_THRESHOLD_MS = 5;
const STALL_THRESHOLD_MS = 50;
const STALL_INTERVAL_MS = 10;

let stallMonitorId = -1;
let stageSignalIds: number[] = [];
let lastSpan = '';

function now(): number {
	return GLib.get_monotonic_time() / 1000;
}

export function perfEnabled(): boolean {
	return ENABLED;
}

export function perfLog(message: string) {
	if (ENABLED) console.log(`[Copyous perf] ${message}`);
}

/**
 * Measures a synchronous span and logs it if it took longer than the threshold
 */
export function measure<T>(label: string, fn: () => T): T {
	if (!ENABLED) return fn();

	const start = now();
	try {
		return fn();
	} finally {
		const duration = now() - start;
		lastSpan = label;
		if (duration >= SPAN_THRESHOLD_MS) perfLog(`${label}: ${duration.toFixed(1)} ms`);
	}
}

/**
 * Starts a timer and returns a function that logs the elapsed time when called
 */
export function timer(label: string): () => void {
	if (!ENABLED) return () => {};

	const start = now();
	return () => perfLog(`${label}: ${(now() - start).toFixed(1)} ms`);
}

/**
 * Starts monitoring the main loop for stalls
 */
export function startStallMonitor() {
	if (!ENABLED || stallMonitorId >= 0) return;

	let last = now();
	stallMonitorId = GLib.timeout_add(GLib.PRIORITY_HIGH, STALL_INTERVAL_MS, () => {
		const t = now();
		const lag = t - last - STALL_INTERVAL_MS;
		if (lag >= STALL_THRESHOLD_MS) perfLog(`main loop stalled ${lag.toFixed(0)} ms (last span: ${lastSpan})`);
		lastSpan = '';
		last = t;
		return GLib.SOURCE_CONTINUE;
	});
}

export function stopStallMonitor() {
	if (stallMonitorId >= 0) GLib.source_remove(stallMonitorId);
	stallMonitorId = -1;
	stageSignalIds.forEach((id) => global.stage.disconnect(id));
	stageSignalIds = [];
}

/**
 * Logs slow stage frames split into layout (before-update -> before-paint) and paint (before-paint -> after-paint)
 */
export function startFrameMonitor() {
	if (!ENABLED || stageSignalIds.length > 0) return;

	let updateStart = 0;
	let paintStart = 0;
	stageSignalIds = [
		global.stage.connect('before-update', () => {
			updateStart = now();
		}),
		global.stage.connect('before-paint', () => {
			paintStart = now();
		}),
		global.stage.connect('after-paint', () => {
			const t = now();
			const layout = paintStart - updateStart;
			const paint = t - paintStart;
			if (VERBOSE || layout + paint >= STALL_THRESHOLD_MS) {
				perfLog(`slow frame: layout ${layout.toFixed(0)} ms, paint ${paint.toFixed(0)} ms`);
			}
		}),
	];
}
