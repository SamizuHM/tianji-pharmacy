"use client";

import { useEffect, useRef } from "react";

export function ParticlesBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let particles: Particle[] = [];
    let mouse = { x: -1000, y: -1000 };

    const PARTICLE_COUNT = 90;
    const CONNECT_DISTANCE = 160;
    const MOUSE_RADIUS = 140;

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    class Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;

      constructor(w: number, h: number) {
        this.x = Math.random() * w;
        this.y = Math.random() * h;
        this.vx = (Math.random() - 0.5) * 0.6;
        this.vy = (Math.random() - 0.5) * 0.6;
        this.radius = Math.random() * 1.5 + 0.5;
      }

      update(w: number, h: number) {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > w) this.vx *= -1;
        if (this.y < 0 || this.y > h) this.vy *= -1;
      }

      draw(ctx: CanvasRenderingContext2D) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(99, 130, 237, 0.35)";
        ctx.fill();
      }
    }

    function init() {
      if (!canvas) return;
      particles = Array.from({ length: PARTICLE_COUNT }, () => new Particle(canvas.width, canvas.height));
    }

    function animate() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.update(canvas.width, canvas.height);
        p.draw(ctx);
      }

      // 粒子之间连线
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DISTANCE) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(99, 130, 237, ${0.15 * (1 - dist / CONNECT_DISTANCE)})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }

        // 鼠标附近连线
        const mx = particles[i].x - mouse.x;
        const my = particles[i].y - mouse.y;
        const md = Math.sqrt(mx * mx + my * my);
        if (md < MOUSE_RADIUS) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.strokeStyle = `rgba(99, 130, 237, ${0.2 * (1 - md / MOUSE_RADIUS)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      animationId = requestAnimationFrame(animate);
    }

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }

    resize();
    init();
    animate();

    window.addEventListener("resize", () => { resize(); init(); });
    window.addEventListener("mousemove", onMouseMove);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <>
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background: "radial-gradient(ellipse at 30% 20%, rgba(147,180,255,0.18) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(167,139,250,0.12) 0%, transparent 50%)"
        }}
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0"
      />
    </>
  );
}
