/** Smooth scrolling, unless the system asks for reduced motion. */
export const scrollBehavior = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
