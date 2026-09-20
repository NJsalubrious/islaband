/* Instance-only experiment. Shared simulator and audio handlers remain untouched. */
(() => {
    function start() {
        const sim = window.fluidSim, config = window.FLUID_CONFIG;
        if (!sim || !config) return;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const originalUpdate = sim.updateConfig.bind(sim);
        let mode = 'ISLA', lastMovement = -10000, lastBurst = -10000, drift = 0, lastSpeed = 0;
        // Measure distance per second, rather than distance per browser event.
        const movePointer = sim._updatePointerMoveData.bind(sim);
        sim._updatePointerMoveData = function(pointer,x,y) {
            const now = performance.now();
            const elapsed = Math.max(8,Math.min(100,now-(pointer.pressureTime ?? now-16.67)))/1000;
            movePointer(pointer,x,y);
            const distance = Math.hypot(pointer.deltaX,pointer.deltaY);
            pointer.pressureSpeed = Math.min(1,distance/elapsed/1.8);
            pointer.pressureTime = now;
        };
        const ember = { r:.14, g:.028, b:.008 };
        const red = { r:.38, g:.014, b:.018 };
        const flame = { r:.42, g:.085, b:.009 };
        const hot = { r:.48, g:.40, b:.012 };
        sim.updateConfig = function(vibe) {
            originalUpdate(vibe);
            mode = vibe;
            if (vibe === 'ISLA') {
                this.targetColor = [.14,.028,.008];
                config.CURL = 45;
                config.DENSITY_DISSIPATION = .989;
                config.VELOCITY_DISSIPATION = .998;
                config.SPLAT_RADIUS = .45;
                config.BLOOM_INTENSITY = .12;
                config.BLOOM_THRESHOLD = .8;
            }
        };
        const splat = sim._splat.bind(sim);
        // Cap inherited event bursts too, so they cannot wash out the typography.
        sim._splat = (x,y,dx,dy,color) => {
            if (reduced.matches) return;
            const peak = Math.max(color.r,color.g,color.b,.001);
            const scale = Math.min(1,.48/peak);
            splat(x,y,dx,dy,{r:color.r*scale,g:color.g*scale,b:color.b*scale});
        };
        sim._processPointers = function() {
            for (const p of this.pointers) {
                if (!p.moved) continue;
                p.moved = false;
                const speed = p.pressureSpeed ?? Math.min(1,Math.hypot(p.deltaX,p.deltaY)*33);
                const distance = Math.max(.000001,Math.hypot(p.deltaX,p.deltaY));
                const force = 60 + Math.pow(speed,1.3)*2750;
                const dx = p.deltaX/distance*force, dy = p.deltaY/distance*force;
                const radius = .10 + Math.pow(speed,1.5)*1.25;
                // Broad red wake, orange body, then a small yellow heat source.
                // Only the outer layer adds force; colour layers do not amplify motion.
                config.SPLAT_RADIUS = radius;
                this._splat(p.texcoordX,p.texcoordY,dx,dy,
                    {r:.18,g:.008,b:.012});
                config.SPLAT_RADIUS = radius*.38;
                this._splat(p.texcoordX,p.texcoordY,0,0,
                    {r:flame.r*.5,g:flame.g*.8,b:flame.b*.4});
                config.SPLAT_RADIUS = Math.max(.018,radius*.065);
                this._splat(p.texcoordX,p.texcoordY,0,0,hot);
                config.SPLAT_RADIUS = radius;
                lastMovement = performance.now();
                lastSpeed = speed;
                // A hard sweep tears sideways as well as following the hand.
                // Rate limited: one six-part impact, not a burst on every frame.
                if (speed>.55 && lastMovement-lastBurst>230) {
                    lastBurst = lastMovement;
                    const direction = Math.atan2(p.deltaY,p.deltaX);
                    for (let i=0;i<6;i++) {
                        const angle = direction+(i-2.5)*.42;
                        const kick = 750+speed*2000;
                        this._splat(
                            Math.max(0,Math.min(1,p.texcoordX+Math.cos(angle)*.03)),
                            Math.max(0,Math.min(1,p.texcoordY+Math.sin(angle)*.03)),
                            Math.cos(angle)*kick+dx*.65,
                            Math.sin(angle)*kick+dy*.65,
                            i%2===0 ? red : ember);
                    }
                }
            }
            if (mode === 'ISLA') {
                const release = Math.max(0,1-(performance.now()-lastMovement)/4000);
                // Less tight coiling; momentum carries the dye across the viewport.
                config.CURL = 22 + release*lastSpeed*32;
                config.DENSITY_DISSIPATION = .984 + release*.012;
                config.VELOCITY_DISSIPATION = .998;
                config.BLOOM_INTENSITY = .08 + release*.12;
                config.SPLAT_RADIUS = .10 + Math.pow(lastSpeed*release,1.5)*1.25;
            }
        };
        sim._ambientSplat = function() {
            if (mode !== 'ISLA' || document.hidden) return;
            drift += .35;
            // Narrow, slow currents at the margins rather than a full-screen cloud.
            const x = drift%1 < .5 ? .07 : .93;
            this._splat(x,.45+Math.sin(drift)*.2,Math.sin(drift)*90,130,
                {r:ember.r*.35,g:ember.g*.35,b:ember.b*.35});
        };
        sim.updateConfig('ISLA');
        sim.currentColor = sim.targetColor.slice();
        document.body.dataset.pressureReady = 'true';
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
})();
