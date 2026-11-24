(() => {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const frames = [...document.querySelectorAll('.brand-logo-frame')];
  let animations = [];
  let generation = 0;

  async function update() {
    const current = ++generation;
    animations.forEach(animation => animation.destroy());
    animations = [];
    frames.forEach(frame => frame.classList.remove('animated'));
    if (motion.matches || !window.lottie) return;
    try {
      const response = await fetch('/static/images/go-event-dj-logo.json');
      if (!response.ok) return;
      const data = await response.json();
      if (current !== generation) return;
      frames.forEach(frame => {
        const animation = lottie.loadAnimation({
          container: frame.querySelector('.brand-animation'),
          renderer: 'svg', loop: true, autoplay: false,
          animationData: JSON.parse(JSON.stringify(data)),
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
        });
        animations.push(animation);
        animation.addEventListener('DOMLoaded', () => {
          frame.classList.add('animated');
          if (!document.hidden) animation.play();
        });
        animation.addEventListener('data_failed', () => frame.classList.remove('animated'));
      });
    } catch {
      // Keep the accessible static logo if the animation cannot load.
    }
  }
  document.addEventListener('visibilitychange', () => {
    animations.forEach(animation => document.hidden ? animation.pause() : animation.play());
  });
  motion.addEventListener('change', update);
  update();
})();
