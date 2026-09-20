/* Confine this experiment's fluid canvas to the content below the hero. */
(() => {
    const hero = document.querySelector('.study-fluid .hero');
    const canvas = document.getElementById('fluid-canvas');
    if (!hero || !canvas) return;
    let queued = false;
    function update() {
        const bottom = hero.getBoundingClientRect().bottom;
        canvas.style.setProperty('--fluid-start', `${Math.max(0, bottom + 70)}px`);
        canvas.style.setProperty('--fluid-full', `${Math.max(0, bottom + 420)}px`);
        queued = false;
    }
    function schedule() {
        if (!queued) { queued = true; requestAnimationFrame(update); }
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    new ResizeObserver(schedule).observe(hero);
    document.fonts.ready.then(schedule);
    function tuneFluid() {
        const sim = window.fluidSim;
        const config = window.FLUID_CONFIG;
        if (!sim || !config) return;
        const originalUpdate = sim.updateConfig.bind(sim);
        sim.updateConfig = function (vibe) {
            originalUpdate(vibe);
            config.SPLAT_FORCE = vibe === 'ISLA' ? 9600 : 6000;
            if (vibe === 'ISLA') {
                config.CURL = 75;
                config.DENSITY_DISSIPATION = 0.988;
                config.BLOOM_INTENSITY = 0.85;
            }
        };
        sim.updateConfig('ISLA');
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tuneFluid, { once: true });
    } else {
        tuneFluid();
    }
    update();
})();
