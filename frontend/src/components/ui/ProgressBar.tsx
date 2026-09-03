import React from 'react';
import './ProgressBar.css';
import clsx from 'clsx';

interface ProgressBarProps {
  progress: number;
  label?: string;
  className?: string;
  colorClass?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ 
  progress, 
  label, 
  className,
  colorClass = 'bg-primary'
}) => {
  const safeProgress = Math.min(Math.max(progress, 0), 100);
  
  return (
    <div className={clsx('progress-wrapper', className)}>
      {label && (
        <div className="progress-label">
          <span>{label}</span>
          <span>{Math.round(safeProgress)}%</span>
        </div>
      )}
      <div className="progress-track">
        <div 
          className={clsx('progress-fill', colorClass)} 
          style={{ width: `${safeProgress}%` }}
        />
      </div>
    </div>
  );
};
