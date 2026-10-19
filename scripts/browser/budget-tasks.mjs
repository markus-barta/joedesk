// Installed before navigation: retain timestamps and attribution, including
// setup tasks, so a failed guard can be tied to a render/worker reply/layout.
// This function is serialized into the page and must have no module closure.
export function observeBudgetTasks() {
  const tasks = [], frames = [];
  const taskEntries = entries => tasks.push(...entries.map(e => ({
    startTime: e.startTime, duration: e.duration, name: e.name,
    attribution: [...e.attribution].map(a => ({ name: a.name, containerType: a.containerType,
      containerId: a.containerId, containerName: a.containerName, containerSrc: a.containerSrc })),
  })));
  const frameEntries = entries => frames.push(...entries.map(e => ({
    startTime: e.startTime, duration: e.duration, blockingDuration: e.blockingDuration,
    renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart,
    scripts: [...e.scripts].map(s => ({ invoker: s.invoker, invokerType: s.invokerType,
      sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName,
      startTime: s.startTime, duration: s.duration, forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration })),
  })));
  const observer = new PerformanceObserver(list => taskEntries(list.getEntries()));
  observer.observe({ type: 'longtask', buffered: true });
  const hasFrames = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame');
  const frameObserver = hasFrames ? new PerformanceObserver(list => frameEntries(list.getEntries())) : null;
  frameObserver?.observe({ type: 'long-animation-frame', buffered: true });
  window.__budgetTasks = { snapshot() {
    // Observer delivery is asynchronous. Include queued entries before ending
    // a window, even when the callback has not run yet.
    taskEntries(observer.takeRecords());
    if (frameObserver) frameEntries(frameObserver.takeRecords());
    return { tasks: tasks.slice(), frames: frames.slice(), hasFrames };
  } };
}

// Use interval overlap, never observer delivery time: a task crossing a window
// boundary still counts. Unmeasured setup remains in the evidence separately.
export function attributeBudgetTasks(trace, timings, windows) {
  const overlaps = (a, b) => a.startTime < b.end && a.startTime + a.duration > b.start;
  return trace.tasks.map(task => {
    const span = { start: task.startTime, end: task.startTime + task.duration };
    return { ...task,
      phases: windows.filter(w => overlaps(task, w)).map(w => w.name),
      events: timings.filter(t => /-(worker|accept)$/.test(t.reason)
        ? t.at >= span.start && t.at <= span.end
        : overlaps({ startTime: t.at, duration: t.ms }, span)),
      frames: trace.frames.filter(f => overlaps(f, span)),
    };
  });
}
