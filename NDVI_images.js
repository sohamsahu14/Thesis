// ========================================
// NDVI Crop Phase Max Area Snapshots — Dhamtari Croplands (2020)
// ========================================

// 1. Load Dhamtari district boundary
var dhamtari = ee.FeatureCollection("FAO/GAUL/2015/level2")
  .filter(ee.Filter.and(
    ee.Filter.eq('ADM1_NAME', 'Chhattisgarh'),
    ee.Filter.eq('ADM2_NAME', 'Dhamtari')
  ));
var dhamtariGeometry = dhamtari.geometry();

// 2. Load ESA WorldCover cropland and scatter it
var worldcover = ee.ImageCollection("ESA/WorldCover/v200").first().clip(dhamtariGeometry);
var cropland10m = worldcover.eq(40).selfMask();
var randomMask = ee.Image.random().lt(0.2);
var scatteredCropland = cropland10m.updateMask(randomMask);
var connected = scatteredCropland.connectedComponents({
  connectedness: ee.Kernel.plus(1),
  maxSize: 100
});
var patchSize = connected.select('labels').connectedPixelCount({
  maxSize: 128,
  eightConnected: true
});
var smallPatches = patchSize.lt(150);
var filteredCropland = scatteredCropland.updateMask(smallPatches);

// 3. Reproject cropland mask to MODIS scale
var croplandMaskAtMODIS = filteredCropland.reproject('EPSG:4326', null, 250);

// 4. Load and process MODIS NDVI data for 2020
var modis = ee.ImageCollection('MODIS/006/MOD13Q1')
  .filterBounds(dhamtariGeometry)
  .filterDate('2020-01-01', '2020-12-31')
  .select(['NDVI', 'DetailedQA']);

var processModis = function(image) {
  var scaled = image.select('NDVI').multiply(0.0001);
  var qa = image.select('DetailedQA');
  var mask = qa.bitwiseAnd(1).eq(0);
  return scaled.updateMask(mask)
              .updateMask(croplandMaskAtMODIS)
              .reproject('EPSG:4326', null, 250)
              .copyProperties(image, ['system:time_start']);
};
var modisProcessed = modis.map(processModis);

// 5. NDVI Classification (Bare soil removed)
var classifyNDVI = function(image) {
  var ndvi = image.select('NDVI');
  var phase = ndvi.expression(
    "(NDVI < 0.4) ? 1 :" +
    "(NDVI < 0.6) ? 2 :" +
    "(NDVI < 0.8) ? 3 :" +
    "(NDVI >= 0.8) ? 4 : 0",
    { 'NDVI': ndvi }
  ).rename('phase');
  return image.addBands(phase).set('system:time_start', image.get('system:time_start'));
};
var classifiedCollection = modisProcessed.map(classifyNDVI);

// 6. Visualisation Parameters (no bare soil)
var phaseVis = {
  min: 1,
  max: 4,
  palette: ['#FFD700', '#00FF00', '#32CD32', '#006400']
};

// 7. White background base layer (beneath everything)
var whiteBg = ee.Image.constant(1).visualize({palette: ['white']});
Map.addLayer(whiteBg.clip(dhamtariGeometry), {}, 'White Background');

// 8. Export max-classified area image for each NDVI class
var phaseBands = [1, 2, 3, 4];
phaseBands.forEach(function(phaseCode) {
  // Create mask collection: binary images where phase equals phaseCode
  var mask = classifiedCollection.map(function(img) {
    return img.select('phase').eq(phaseCode);
  });
  // Fix: mask is already an ImageCollection, no need to wrap in ee.ImageCollection()
  // Sum all masks to get count of times each pixel has this phase
  var areaImage = mask.sum().rename('count');
  
  // Fix: Cannot use computed reduceRegion result directly in eq() expression
  // Need to compute max value first, then convert Element to Number for ee.Image.constant()
  var maxValue = ee.Number(areaImage.reduceRegion({
    reducer: ee.Reducer.max(),
    geometry: dhamtariGeometry,
    scale: 250,
    maxPixels: 1e9
  }).get('count'));
  // Create constant image with max value for comparison (maxImage computed but available for future use)
  var maxImage = areaImage.eq(ee.Image.constant(maxValue));

  // Fix: Renamed variable for clarity - this is an ImageCollection, not a single mask
  // Create collection of phase images masked to only show pixels with current phaseCode
  var phaseCollection = classifiedCollection.map(function(img) {
    return img.updateMask(img.select('phase').eq(phaseCode)).select('phase');
  });
  // Get maximum phase value across all images (for pixels that had this phase at some point)
  var composite = phaseCollection.max().visualize({
    min: 1,
    max: 4,
    palette: ['#FFD700', '#00FF00', '#32CD32', '#006400']
  });

  Map.addLayer(composite.clip(dhamtariGeometry), {}, 'Max Area Phase: ' + phaseCode);
});

// 9. Legend (Bare Soil removed)
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 15px', backgroundColor: '#FFFFFF'}});
legend.add(ui.Label({
  value: 'NDVI Phase Classification',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 6px 0'}
}));

var legendItems = [
  {color: '#FFD700', label: 'Initial Growth (0.2–0.4)'},
  {color: '#00FF00', label: 'Transplanting (0.4–0.6)'},
  {color: '#32CD32', label: 'Heading (0.6–0.8)'},
  {color: '#006400', label: 'Maturity (> 0.8)'}
];

legendItems.forEach(function(item) {
  var colorBox = ui.Label('', {
    backgroundColor: item.color,
    padding: '8px',
    margin: '0 8px 0 0'
  });
  var description = ui.Label({value: item.label, style: {margin: '0 0 4px 0'}});
  legend.add(ui.Panel([colorBox, description], ui.Panel.Layout.Flow('horizontal')));
});

Map.add(legend);

// 10. Map Layers
Map.setOptions('TERRAIN');
Map.centerObject(dhamtariGeometry, 10);
Map.addLayer(dhamtari, {color: 'lightblue'}, 'District Boundary Outline');
