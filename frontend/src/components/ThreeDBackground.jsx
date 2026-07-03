import React, { useEffect, useRef } from 'react';

export default function ThreeDBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    // Dimensions
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // 3D Particles Config
    const particleCount = 75;
    const particles = [];
    const focalLength = 400;
    const distance = 400;
    
    // Mouse interaction
    let mouse = { x: 0, y: 0, targetX: 0, targetY: 0, active: false };

    const handleMouseMove = (e) => {
      mouse.targetX = (e.clientX - window.innerWidth / 2) * 0.3;
      mouse.targetY = (e.clientY - window.innerHeight / 2) * 0.3;
      mouse.active = true;
    };

    const handleMouseLeave = () => {
      mouse.active = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    // Initialize 3D points
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 800,
        y: (Math.random() - 0.5) * 800,
        z: (Math.random() - 0.5) * 800,
        baseX: (Math.random() - 0.5) * 800,
        baseY: (Math.random() - 0.5) * 800,
        baseZ: (Math.random() - 0.5) * 800,
        size: Math.random() * 2 + 1,
        // HSL Hue rotation
        hue: Math.floor(Math.random() * 60) + 200, // 200 to 260: Blue to Purple
        speed: (Math.random() * 0.005) + 0.002
      });
    }

    // Rotations angle
    let angleX = 0.001;
    let angleY = 0.0015;

    // Render loop
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Smooth mouse follow
      mouse.x += (mouse.targetX - mouse.x) * 0.08;
      mouse.y += (mouse.targetY - mouse.y) * 0.08;

      // Draw faint glowing gradient ambient lights
      const gradient = ctx.createRadialGradient(
        canvas.width / 2 + mouse.x, canvas.height / 2 + mouse.y, 10,
        canvas.width / 2 + mouse.x, canvas.height / 2 + mouse.y, canvas.width * 0.5
      );
      gradient.addColorStop(0, 'rgba(91, 95, 239, 0.04)'); // Glowing Indigo
      gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.02)'); // Lavender
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Rotate points
      const sinX = Math.sin(angleX);
      const cosX = Math.cos(angleX);
      const sinY = Math.sin(angleY);
      const cosY = Math.cos(angleY);

      const projected = [];

      particles.forEach((p, idx) => {
        // Orbit motion
        p.x = p.baseX + Math.sin(Date.now() * p.speed) * 40;
        p.y = p.baseY + Math.cos(Date.now() * p.speed) * 40;

        // Rotate X
        let y1 = p.y * cosX - p.z * sinX;
        let z1 = p.z * cosX + p.y * sinX;

        // Rotate Y
        let x2 = p.x * cosY - z1 * sinY;
        let z2 = z1 * cosY + p.x * sinY;

        // Parallax depth mapping based on cursor position
        let finalX = x2 + mouse.x * (z2 / 400 + 1);
        let finalY = y1 + mouse.y * (z2 / 400 + 1);
        let finalZ = z2 + distance;

        // Perspective projection
        if (finalZ > 10) {
          const scale = focalLength / finalZ;
          const projX = canvas.width / 2 + finalX * scale;
          const projY = canvas.height / 2 + finalY * scale;
          
          projected.push({
            x: projX,
            y: projY,
            z: finalZ,
            size: p.size * scale * 1.5,
            hue: p.hue,
            idx
          });
        }
      });

      // Draw Connections (Constellation style)
      ctx.lineWidth = 0.5;
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const pi = projected[i];
          const pj = projected[j];
          
          // Distance in screen space
          const dx = pi.x - pj.x;
          const dy = pi.y - pj.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Connection limit
          if (dist < 120) {
            const alpha = (1 - dist / 120) * 0.15;
            // High-tech gradient between connection nodes
            const lineGrad = ctx.createLinearGradient(pi.x, pi.y, pj.x, pj.y);
            lineGrad.addColorStop(0, `rgba(6, 182, 212, ${alpha})`); // Cyan
            lineGrad.addColorStop(0.5, `rgba(168, 85, 247, ${alpha * 0.8})`); // Purple
            lineGrad.addColorStop(1, `rgba(91, 95, 239, ${alpha})`); // Indigo
            
            ctx.strokeStyle = lineGrad;
            ctx.beginPath();
            ctx.moveTo(pi.x, pi.y);
            ctx.lineTo(pj.x, pj.y);
            ctx.stroke();
          }
        }
      }

      // Draw Nodes
      projected.sort((a, b) => b.z - a.z); // Depth sorting
      projected.forEach(p => {
        // Neon color gradient for each node
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
        glow.addColorStop(0, `hsla(${p.hue}, 90%, 65%, 0.8)`);
        glow.addColorStop(0.5, `hsla(${p.hue + 20}, 85%, 60%, 0.25)`);
        glow.addColorStop(1, 'transparent');

        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      });

      // Slowly rotate world
      angleX += 0.0006;
      angleY += 0.0004;

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className="fixed inset-0 w-full h-full pointer-events-none" 
      style={{ zIndex: 0, opacity: 0.85 }}
    />
  );
}
