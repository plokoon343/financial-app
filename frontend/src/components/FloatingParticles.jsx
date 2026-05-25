import React, { useEffect, useState } from 'react';

const FloatingParticles = () => {
  const [particles, setParticles] = useState([]);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const generateParticles = () => {
      const particleTypes = ['circle', 'blob', 'triangle', 'square', 'star'];
      const colors = [
        'rgba(102, 126, 234, 0.6)',  // Primary blue
        'rgba(118, 75, 162, 0.6)',   // Purple
        'rgba(240, 147, 251, 0.6)',  // Pink
        'rgba(79, 172, 254, 0.6)',   // Light blue
        'rgba(255, 193, 7, 0.6)',    // Gold
        'rgba(102, 187, 106, 0.6)',  // Green
        'rgba(229, 115, 115, 0.6)'   // Red
      ];

      const newParticles = Array.from({ length: 50 }, (_, i) => {
        const type = particleTypes[Math.floor(Math.random() * particleTypes.length)];
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        return {
          id: i,
          size: Math.random() * 25 + 8,
          left: Math.random() * 100,
          top: Math.random() * 100,
          animationDuration: Math.random() * 25 + 15,
          animationDelay: Math.random() * 10,
          opacity: Math.random() * 0.4 + 0.1,
          type,
          color,
          driftAmount: Math.random() * 40 - 20, // Horizontal drift
          pulseSpeed: Math.random() * 2 + 1,
          rotation: Math.random() * 360,
          spinSpeed: Math.random() * 2 - 1 // Negative for counter-clockwise
        };
      });
      setParticles(newParticles);
    };

    generateParticles();

    // Handle mouse move for interactive particles
    const handleMouseMove = (e) => {
      setMousePosition({
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Calculate distance from mouse for interactive effects
  const getDistanceFromMouse = (particleLeft, particleTop) => {
    const dx = particleLeft - mousePosition.x;
    const dy = particleTop - mousePosition.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  return (
    <div className="floating-particles">
      {particles.map(particle => {
        const distanceFromMouse = getDistanceFromMouse(particle.left, particle.top);
        const isNearMouse = distanceFromMouse < 15;
        
        return (
          <div
            key={particle.id}
            className={`particle particle-${particle.type} ${isNearMouse ? 'particle-interactive' : ''}`}
            style={{
              '--particle-size': `${particle.size}px`,
              '--particle-left': `${particle.left}%`,
              '--particle-top': `${particle.top}%`,
              '--animation-duration': `${particle.animationDuration}s`,
              '--animation-delay': `${particle.animationDelay}s`,
              '--particle-opacity': particle.opacity,
              '--particle-color': particle.color,
              '--drift-amount': `${particle.driftAmount}px`,
              '--pulse-speed': `${particle.pulseSpeed}s`,
              '--rotation': `${particle.rotation}deg`,
              '--spin-speed': `${particle.spinSpeed}s`,
              '--mouse-distance': distanceFromMouse
            }}
          />
        );
      })}
      
      {/* Interactive glow effect */}
      <div 
        className="particle-glow"
        style={{
          left: `${mousePosition.x}%`,
          top: `${mousePosition.y}%`
        }}
      />
    </div>
  );
};

export default FloatingParticles;