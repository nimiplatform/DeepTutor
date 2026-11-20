import React, { forwardRef } from 'react';

type StaticImageData = {
  src: string;
  width?: number;
  height?: number;
};

export type ImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | StaticImageData;
  alt: string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
  quality?: number | string;
  placeholder?: string;
  blurDataURL?: string;
  loader?: unknown;
};

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    alt,
    fill,
    priority: _priority,
    unoptimized: _unoptimized,
    quality: _quality,
    placeholder: _placeholder,
    blurDataURL: _blurDataURL,
    loader: _loader,
    style,
    width,
    height,
    ...rest
  },
  ref,
) {
  const resolvedSrc = typeof src === 'string' ? src : src.src;
  const fillStyle: React.CSSProperties | undefined = fill
    ? {
        position: 'absolute',
        height: '100%',
        width: '100%',
        inset: 0,
        ...style,
      }
    : style;

  return (
    <img
      ref={ref}
      src={resolvedSrc}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      style={fillStyle}
      {...rest}
    />
  );
});

export default Image;
