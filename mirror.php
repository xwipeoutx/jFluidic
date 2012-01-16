<?php
$src = $_GET['src'];
echo "data:image/png;base64,";
echo base64_encode(file_get_contents($src));