import React, { useState, useEffect } from 'react';

const FinancialCarousel = () => {
  const [currentSlide, setCurrentSlide] = useState(0);
  
  const tips = [
    {
      id: 1,
      title: "💡 Smart Saving Tip",
      content: "Save at least 20% of your income for long-term financial security",
      color: "#667eea"
    },
    {
      id: 2,
      title: "📊 Track Your Spending",
      content: "Monitor your expenses daily to identify saving opportunities",
      color: "#764ba2"
    },
    {
      id: 3,
      title: "🎯 Set Financial Goals",
      content: "Define clear financial objectives and track your progress",
      color: "#f093fb"
    },
    {
      id: 4,
      title: "💰 Emergency Fund",
      content: "Maintain 3-6 months of expenses in your emergency fund",
      color: "#4facfe"
    }
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % tips.length);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [tips.length]);

  return (
    <div className="financial-carousel">
      <div className="carousel-container">
        {tips.map((tip, index) => (
          <div
            key={tip.id}
            className={`carousel-slide ${index === currentSlide ? 'active' : ''}`}
            style={{ '--accent-color': tip.color }}
          >
            <div className="slide-content">
              <h3>{tip.title}</h3>
              <p>{tip.content}</p>
            </div>
          </div>
        ))}
      </div>
      
      <div className="carousel-indicators">
        {tips.map((_, index) => (
          <button
            key={index}
            className={`indicator ${index === currentSlide ? 'active' : ''}`}
            onClick={() => setCurrentSlide(index)}
          />
        ))}
      </div>
    </div>
  );
};

export default FinancialCarousel;