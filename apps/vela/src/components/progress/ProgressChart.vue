<template>
  <div class="progress-chart" :style="{ height: `${height}px` }">
    <canvas ref="chartCanvas" :width="width ?? 400" :height="height"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';

interface ChartData {
  date: string;
  [key: string]: number | string;
}

interface Props {
  data: ChartData[];
  type: 'line' | 'bar';
  height: number;
  dataKey: string;
  color: string;
  width?: number;
}

const props = withDefaults(defineProps<Props>(), {
  width: 400,
});

const chartCanvas = ref<HTMLCanvasElement>();

const drawChart = () => {
  if (!chartCanvas.value || !props.data.length) return;

  const canvas = chartCanvas.value;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Chart dimensions
  const padding = 40;
  const chartWidth = canvas.width - 2 * padding;
  const chartHeight = canvas.height - 2 * padding;

  // Get data values
  const values = props.data.map((d) => Number(d[props.dataKey]) || 0);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);

  // Color mapping
  const colorMap: { [key: string]: string } = {
    primary: '#1976D2',
    secondary: '#26A69A',
    accent: '#9C27B0',
    warning: '#FF9800',
    positive: '#21BA45',
    negative: '#C10015',
    info: '#31CCEC',
  };

  const chartColor = colorMap[props.color] || props.color;

  if (props.type === 'line') {
    drawLineChart(ctx, values, chartWidth, chartHeight, padding, maxValue, minValue, chartColor);
  } else {
    drawBarChart(ctx, values, chartWidth, chartHeight, padding, maxValue, chartColor);
  }

  // Draw axes and labels
  drawAxes(ctx, chartWidth, chartHeight, padding);
  drawLabels(ctx, chartWidth, chartHeight, padding, maxValue);
};

const drawLineChart = (
  ctx: CanvasRenderingContext2D,
  values: number[],
  chartWidth: number,
  chartHeight: number,
  padding: number,
  maxValue: number,
  minValue: number,
  color: string,
) => {
  if (values.length === 0) return;

  const stepX = chartWidth / (values.length - 1 || 1);
  const range = maxValue - minValue || 1;

  // Draw line
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  values.forEach((value, index) => {
    const x = padding + index * stepX;
    const y = padding + chartHeight - ((value - minValue) / range) * chartHeight;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  // Draw points
  ctx.fillStyle = color;
  values.forEach((value, index) => {
    const x = padding + index * stepX;
    const y = padding + chartHeight - ((value - minValue) / range) * chartHeight;

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fill();
  });

  // Draw area under curve
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(padding, padding + chartHeight);

  values.forEach((value, index) => {
    const x = padding + index * stepX;
    const y = padding + chartHeight - ((value - minValue) / range) * chartHeight;
    ctx.lineTo(x, y);
  });

  ctx.lineTo(padding + chartWidth, padding + chartHeight);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
};

const drawBarChart = (
  ctx: CanvasRenderingContext2D,
  values: number[],
  chartWidth: number,
  chartHeight: number,
  padding: number,
  maxValue: number,
  color: string,
) => {
  if (values.length === 0) return;

  const barWidth = (chartWidth / values.length) * 0.8;
  const barSpacing = (chartWidth / values.length) * 0.2;

  ctx.fillStyle = color;

  values.forEach((value, index) => {
    const x = padding + index * (barWidth + barSpacing) + barSpacing / 2;
    const barHeight = (value / maxValue) * chartHeight;
    const y = padding + chartHeight - barHeight;

    ctx.fillRect(x, y, barWidth, barHeight);
  });
};

const drawAxes = (
  ctx: CanvasRenderingContext2D,
  chartWidth: number,
  chartHeight: number,
  padding: number,
) => {
  ctx.strokeStyle = '#E0E0E0';
  ctx.lineWidth = 1;

  // Y-axis
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, padding + chartHeight);
  ctx.stroke();

  // X-axis
  ctx.beginPath();
  ctx.moveTo(padding, padding + chartHeight);
  ctx.lineTo(padding + chartWidth, padding + chartHeight);
  ctx.stroke();
};

const drawLabels = (
  ctx: CanvasRenderingContext2D,
  chartWidth: number,
  chartHeight: number,
  padding: number,
  maxValue: number,
) => {
  ctx.fillStyle = '#666';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';

  // X-axis labels (dates)
  props.data.forEach((item, index) => {
    const x = padding + (index * chartWidth) / (props.data.length - 1 || 1);
    const y = padding + chartHeight + 20;
    ctx.fillText(item.date, x, y);
  });

  // Y-axis labels
  ctx.textAlign = 'right';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const value = Math.round((maxValue * i) / steps);
    const y = padding + chartHeight - (i * chartHeight) / steps;
    ctx.fillText(value.toString(), padding - 10, y + 4);
  }
};

watch(
  () => props.data,
  () => {
    void nextTick(() => {
      drawChart();
    });
  },
  { deep: true },
);

onMounted(() => {
  void nextTick(() => {
    drawChart();
  });
});
</script>

<style scoped lang="scss">
.progress-chart {
  position: relative;
  width: 100%;

  canvas {
    width: 100%;
    height: 100%;
  }
}
</style>
